"""Nightly production ingest: fetch one night's real games and score the model.

Pure synchronous Polars/ESPN code — no DB, no asyncio. The app layer
(app/services/model_nightly_service.py) orchestrates: it builds a FeatureStore
from rows *before* the night, calls ``evaluate_night`` (predictions therefore
use no data from the night itself), persists the results, then ingests the
night's raw rows.

``fetch_night`` also disambiguates a genuine off-night from data lag via the
scoreboard: zero scheduled games is a done state, while missing/unfinal logs
mean "come back later".
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import polars as pl

from .. import espn
from ..research import config as rconfig
from . import featurize
from .feature_store import FeatureStore
from .inference import LiveInference, PredictionRequest
from .eval_row import EvalRow, _actual_line

season_for = espn.season_for

logger = logging.getLogger(__name__)

_WHITELIST_TTL = timedelta(hours=24)
_whitelist_cache: dict = {'dates': None, 'ts': None}


def _whitelist_has(game_date: date) -> bool:
    """True if ESPN's own whitelist calendar lists ``game_date`` as a game day.

    The whitelist includes preseason/playoffs/All-Star too, so it can only
    answer "did ESPN schedule *something* this day", not countability — the
    caller only uses this to tell a real scoreboard gap from a genuine
    off-night when the day-scoreboard fetch itself came back empty.
    """
    now = datetime.now()
    if _whitelist_cache['ts'] is None or now - _whitelist_cache['ts'] >= _WHITELIST_TTL:
        try:
            raw = espn.client.calendar_whitelist()
        except Exception as e:
            # A second independent ESPN failure must not stall the pipeline —
            # fall back to today's behavior (seal the night as a genuine no-games).
            logger.warning(f"calendar_whitelist fetch failed, treating {game_date} as no-games: {e}")
            return False
        _whitelist_cache['dates'] = {
            datetime.fromisoformat(s.replace('Z', '+00:00'))
            .astimezone(ZoneInfo('America/New_York'))
            .date()
            for s in raw
        }
        _whitelist_cache['ts'] = now
    return game_date in _whitelist_cache['dates']


@dataclass
class NightFetch:
    game_date: date
    player_games: pl.DataFrame   # cleaned player logs (regular season, MIN > 0)
    team_games: pl.DataFrame     # raw team logs (regular season; both teams of each game)
    expected_games: int          # countable regular-season games on the scoreboard
    complete: bool               # all expected games final AND the logs cover them


def fetch_night(game_date: date) -> NightFetch:
    """Fetch one night's player + team logs and judge whether the data is complete."""
    day = espn.fetch_day(game_date)
    if day.expected_games == 0:
        empty = pl.DataFrame()
        if day.total_events == 0 and _whitelist_has(game_date):
            # ESPN's own whitelist says this is a game day, but the scoreboard
            # returned nothing — treat as incomplete data, not a sealed off-night.
            return NightFetch(game_date, empty, empty, 0, complete=False)
        return NightFetch(game_date, empty, empty, 0, complete=True)

    player_games = featurize.to_date(day.players)
    team_games = featurize.to_date(day.teams)

    # DNP rows (MIN null/0) are dropped; the >= MIN_MINUTES research/model-quality
    # filter is not applied at write time — it gates at read time in
    # DBService.get_fs_rows_before, so storage keeps every played minute for
    # other consumers (e.g. the dynamic time-range player stats aggregation).
    if not player_games.is_empty():
        player_games = player_games.filter(
            pl.col("MIN").is_not_null() & ~pl.col("MIN").is_nan() & (pl.col("MIN") > 0)
        )

    complete = (
        day.all_final
        and len(team_games) == 2 * day.expected_games
        and not player_games.is_empty()
    )
    return NightFetch(game_date, player_games, team_games, day.expected_games, complete)


def evaluate_night(
    store: FeatureStore, inference: LiveInference, night: NightFetch
) -> list[EvalRow]:
    """Score every player of the night against actuals (predictions use the real
    minutes played and a store that must NOT contain the night's rows)."""
    allowed = featurize.build_team_allowed(night.team_games)
    opp_map = {
        (g, t): o for g, t, o in zip(
            allowed["GAME_ID"].to_list(), allowed["TEAM_ID"].to_list(), allowed["OPP_TEAM_ID"].to_list())
    }

    reqs: list[PredictionRequest] = []
    meta = []  # rows aligned to reqs
    evals: list[EvalRow] = []
    for row in night.player_games.iter_rows(named=True):
        opp = int(opp_map.get((row["GAME_ID"], row["TEAM_ID"]), -1))
        ev = EvalRow(
            player_id=int(row["PLAYER_ID"]),
            player_name=str(row.get("PLAYER_NAME", row["PLAYER_ID"])),
            team_id=int(row["TEAM_ID"]),
            opponent_team_id=opp,
            is_home="vs" in str(row["MATCHUP"]),
            real_minutes=float(row["MIN"]),
            eligible=True,
            game_id=str(row["GAME_ID"]),
            actual=_actual_line(row),
        )
        # predict_many only tolerates per-request player errors; an unknown TEAM
        # raises out of the whole batch, so filter those requests up front.
        if not store.has_team(opp):
            ev.eligible = False
            ev.reason = f"opponent team {opp} not in feature store"
            evals.append(ev)
            continue
        reqs.append(PredictionRequest(
            player_id=ev.player_id,
            opponent_team_id=opp,
            is_home=ev.is_home,
            game_date=night.game_date,
            minutes=ev.real_minutes,
        ))
        meta.append(ev)

    results, errors = inference.predict_many(reqs)
    for ev, res, err in zip(meta, results, errors):
        if err is not None:
            ev.eligible = False
            ev.reason = str(err)
        else:
            ev.predicted = {k: round(v.value, 2) for k, v in res.stats.items()}
        evals.append(ev)
    return evals


def attach_positions(store: FeatureStore, player_games: pl.DataFrame) -> pl.DataFrame:
    """Fill missing POSITION values from the player's last-known store position.

    ESPN box scores carry POSITION per row, but occasionally leave it empty;
    ``build_current_state`` takes the per-player last(), so un-annotated rows
    would wipe positions on recompute. Brand-new players with no store history
    stay "" (position flags 0) until a later game/roster carries it.
    """
    out = player_games
    if "POSITION" not in out.columns:
        out = out.with_columns(pl.lit("").alias("POSITION"))
    if "POSITION" in store.players.columns:
        known = (
            store.players.filter(pl.col("POSITION").is_not_null())
            .group_by("PLAYER_ID", maintain_order=True)
            .agg(pl.col("POSITION").last().alias("_KNOWN"))
        )
    else:
        known = pl.DataFrame(schema={"PLAYER_ID": out.schema["PLAYER_ID"], "_KNOWN": pl.String})
    out = out.join(known.with_columns(pl.col("PLAYER_ID").cast(out.schema["PLAYER_ID"])),
                   on="PLAYER_ID", how="left", maintain_order="left")
    pos = pl.col("POSITION").fill_null("")
    return out.with_columns(
        pl.when(pos != "").then(pos).otherwise(pl.col("_KNOWN").fill_null("")).alias("POSITION")
    ).drop("_KNOWN")


# --- Bootstrap (one-time init of the raw-rows store) ------------------------

# Bootstrap-only memory saver (the nightly path never filters players): rows of
# players whose most recent game is at least this old (retired / out of the
# league) are not stored. A comeback player is re-added by the nightly ingest
# the day he plays (history restarts from zero, so MIN_INFERENCE_GAMES gates
# him like any newcomer).
STALE_PLAYER_YEARS = 2


def _years_before(d: date, years: int) -> date:
    """d minus whole years (Feb 29 -> Feb 28), like pandas' DateOffset(years=...)."""
    try:
        return d.replace(year=d.year - years)
    except ValueError:
        return d.replace(year=d.year - years, day=28)


def drop_stale_players(players: pl.DataFrame, as_of: date) -> pl.DataFrame:
    """Remove all rows of players whose newest game is >= STALE_PLAYER_YEARS old."""
    cutoff = _years_before(as_of, STALE_PLAYER_YEARS)
    return players.filter(pl.col("GAME_DATE").max().over("PLAYER_ID") > cutoff)


def bootstrap_frames(until_date: date | None = None) -> tuple[pl.DataFrame, pl.DataFrame]:
    """Fetch and clean the full-history frames used to seed the Postgres store.

    Returns (player_games, team_games) for ``research/config.SEASONS``, with the
    same row filter as the nightly fetch. ``until_date`` (exclusive) trims the
    frames for mid-season replay testing. POSITION comes per-row from the ESPN
    box scores, so no separate roster crawl is needed.
    """
    players, team_games = espn.fetch_seasons(rconfig.SEASONS, cache_dir=rconfig.DATA_DIR / "espn_cache")
    players = featurize.to_date(players)
    team_games = featurize.to_date(team_games)

    players = players.filter(pl.col("MIN").is_not_null() & ~pl.col("MIN").is_nan() & (pl.col("MIN") > 0))
    players = players.sort(["PLAYER_ID", "GAME_DATE"], maintain_order=True)
    players = players.with_columns(pl.col("POSITION").fill_null(""))

    if until_date is not None:
        players = players.filter(pl.col("GAME_DATE") < until_date)
        team_games = team_games.filter(pl.col("GAME_DATE") < until_date)

    # Staleness is judged as of the snapshot point so --until-date replays
    # behave exactly like a bootstrap run on that date would have.
    players = drop_stale_players(players, until_date or date.today())
    return players, team_games

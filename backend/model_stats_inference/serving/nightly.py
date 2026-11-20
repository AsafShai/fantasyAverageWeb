"""Nightly production ingest: fetch one night's real games and score the model.

Pure synchronous pandas/ESPN code — no DB, no asyncio. The app layer
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

import pandas as pd

from .. import espn
from ..research import config as rconfig
from ..research import data as rdata
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
    player_games: pd.DataFrame   # cleaned player logs (regular season, MIN > 0)
    team_games: pd.DataFrame     # raw team logs (regular season; both teams of each game)
    expected_games: int          # countable regular-season games on the scoreboard
    complete: bool               # all expected games final AND the logs cover them


def fetch_night(game_date: date) -> NightFetch:
    """Fetch one night's player + team logs and judge whether the data is complete."""
    day = espn.fetch_day(game_date)
    if day.expected_games == 0:
        empty = pd.DataFrame()
        if day.total_events == 0 and _whitelist_has(game_date):
            # ESPN's own whitelist says this is a game day, but the scoreboard
            # returned nothing — treat as incomplete data, not a sealed off-night.
            return NightFetch(game_date, empty, empty, 0, complete=False)
        return NightFetch(game_date, empty, empty, 0, complete=True)

    player_games = rdata._to_datetime(day.players)
    team_games = rdata._to_datetime(day.teams)

    # DNP rows (MIN null/0) are dropped; the >= MIN_MINUTES research/model-quality
    # filter is not applied at write time — it gates at read time in
    # DBService.get_fs_rows_before, so storage keeps every played minute for
    # other consumers (e.g. the dynamic time-range player stats aggregation).
    if not player_games.empty:
        player_games = player_games[
            player_games["MIN"].notna() & (player_games["MIN"] > 0)
        ].reset_index(drop=True)

    complete = (
        day.all_final
        and len(team_games) == 2 * day.expected_games
        and not player_games.empty
    )
    return NightFetch(game_date, player_games, team_games, day.expected_games, complete)


# --- later corrections -------------------------------------------------------

# The stats a stored row holds; a difference in any of them is a correction.
PLAYER_STAT_COLUMNS = [
    "MIN", "PTS", "REB", "OREB", "DREB", "AST", "FG3M", "FG3A", "STL", "BLK",
    "TOV", "FGM", "FGA", "FTM", "FTA", "PF", "PLUS_MINUS",
]
TEAM_STAT_COLUMNS = ["PTS", "REB", "AST", "STL", "BLK", "FG3M", "FG_PCT", "FGA", "FTA", "TOV"]
_TOLERANCE = 1e-6


@dataclass
class NightCorrections:
    """What ESPN changed in a stored night: rows as ESPN has them now."""
    changed_players: pd.DataFrame    # stored lines whose stats differ
    new_players: pd.DataFrame        # lines ESPN has and the store doesn't
    changed_teams: pd.DataFrame      # stored team rows whose stats differ
    vanished_players: list[tuple]    # (PLAYER_ID, GAME_ID) stored but no longer in ESPN's box

    @property
    def empty(self) -> bool:
        return self.changed_players.empty and self.new_players.empty and self.changed_teams.empty

    def player_ids(self) -> list[int]:
        ids = pd.concat([self.changed_players["PLAYER_ID"], self.new_players["PLAYER_ID"]])
        return sorted({int(p) for p in ids})


def _keyed(frame: pd.DataFrame, id_col: str) -> pd.DataFrame:
    if frame is None or frame.empty or id_col not in frame.columns:
        return pd.DataFrame(columns=list(frame.columns) if frame is not None else [])
    out = frame.copy()
    out["_KEY"] = list(zip(out[id_col].astype("int64"), out["GAME_ID"].astype(str)))
    return out.set_index("_KEY")


def _differs(stored: pd.DataFrame, fresh: pd.DataFrame, cols: list[str]) -> pd.Index:
    """Keys present in both whose stats differ in any of ``cols``."""
    common = stored.index.intersection(fresh.index)
    if common.empty:
        return common
    cols = [c for c in cols if c in stored.columns and c in fresh.columns]
    a = stored.loc[common, cols].apply(pd.to_numeric, errors="coerce").fillna(0.0).to_numpy(float)
    b = fresh.loc[common, cols].apply(pd.to_numeric, errors="coerce").fillna(0.0).to_numpy(float)
    return common[(abs(a - b) > _TOLERANCE).any(axis=1)]


def diff_night(
    stored_players: pd.DataFrame, stored_teams: pd.DataFrame,
    fresh_players: pd.DataFrame, fresh_teams: pd.DataFrame,
) -> NightCorrections:
    """Compare a night as stored with the same night as ESPN serves it now.

    ``fresh_*`` are ``fetch_night`` frames (played lines only). Changed and new
    rows come back as ESPN has them; a line ESPN no longer lists is only
    reported (a box score losing a player is far likelier a feed hiccup than a
    correction, so it is never deleted)."""
    sp, fp = _keyed(stored_players, "PLAYER_ID"), _keyed(fresh_players, "PLAYER_ID")
    st, ft = _keyed(stored_teams, "TEAM_ID"), _keyed(fresh_teams, "TEAM_ID")
    changed = _differs(sp, fp, PLAYER_STAT_COLUMNS)
    new = fp.index.difference(sp.index)
    vanished = sp.index.difference(fp.index)
    changed_teams = _differs(st, ft, TEAM_STAT_COLUMNS)
    return NightCorrections(
        changed_players=fp.loc[changed].reset_index(drop=True),
        new_players=fp.loc[new].reset_index(drop=True),
        changed_teams=ft.loc[changed_teams].reset_index(drop=True),
        vanished_players=list(vanished),
    )


def evaluate_night(
    store: FeatureStore, inference: LiveInference, night: NightFetch
) -> list[EvalRow]:
    """Score every player of the night against actuals (predictions use the real
    minutes played and a store that must NOT contain the night's rows)."""
    opp_map = (
        rdata.build_team_allowed(night.team_games)
        .set_index(["GAME_ID", "TEAM_ID"])["OPP_TEAM_ID"]
        .to_dict()
    )

    reqs: list[PredictionRequest] = []
    meta = []  # rows aligned to reqs
    evals: list[EvalRow] = []
    for _, row in night.player_games.iterrows():
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
        if opp not in store.team_allowed_vectors.index:
            ev.eligible = False
            ev.reason = f"opponent team {opp} not in feature store"
            evals.append(ev)
            continue
        reqs.append(PredictionRequest(
            player_id=ev.player_id,
            opponent_team_id=opp,
            is_home=ev.is_home,
            game_date=pd.Timestamp(night.game_date),
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


def attach_positions(store: FeatureStore, player_games: pd.DataFrame) -> pd.DataFrame:
    """Fill missing POSITION values from the player's last-known store position.

    ESPN box scores carry POSITION per row, but occasionally leave it empty;
    ``build_current_state`` takes the per-player last(), so un-annotated rows
    would wipe positions on recompute. Brand-new players with no store history
    stay "" (position flags 0) until a later game/roster carries it.
    """
    out = player_games.copy()
    if "POSITION" not in out.columns:
        out["POSITION"] = ""
    known = (
        store.players.dropna(subset=["POSITION"])
        .groupby("PLAYER_ID")["POSITION"].last()
        if "POSITION" in store.players.columns
        else pd.Series(dtype=str)
    )
    pos = out["POSITION"].fillna("")
    fallback = out["PLAYER_ID"].map(known).fillna("")
    out["POSITION"] = pos.where(pos != "", fallback)
    return out


# --- Bootstrap (one-time init of the raw-rows store) ------------------------

# Bootstrap-only memory saver (the nightly path never filters players): rows of
# players whose most recent game is at least this old (retired / out of the
# league) are not stored. A comeback player is re-added by the nightly ingest
# the day he plays (history restarts from zero, so MIN_INFERENCE_GAMES gates
# him like any newcomer).
STALE_PLAYER_YEARS = 2


def drop_stale_players(players: pd.DataFrame, as_of: date) -> pd.DataFrame:
    """Remove all rows of players whose newest game is >= STALE_PLAYER_YEARS old."""
    cutoff = pd.Timestamp(as_of) - pd.DateOffset(years=STALE_PLAYER_YEARS)
    last = players.groupby("PLAYER_ID")["GAME_DATE"].transform("max")
    return players[last > cutoff].reset_index(drop=True)


def bootstrap_frames(until_date: date | None = None) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Fetch and clean the full-history frames used to seed the Postgres store.

    Returns (player_games, team_games) for ``research/config.SEASONS``, with the
    same row filter as the nightly fetch. ``until_date`` (exclusive) trims the
    frames for mid-season replay testing. POSITION comes per-row from the ESPN
    box scores, so no separate roster crawl is needed.
    """
    players, team_games = rdata.fetch_game_logs(rconfig.SEASONS)
    players = rdata._to_datetime(players)
    team_games = rdata._to_datetime(team_games)

    players = players[players["MIN"].notna() & (players["MIN"] > 0)]
    players = players.sort_values(["PLAYER_ID", "GAME_DATE"]).reset_index(drop=True)
    players["POSITION"] = players["POSITION"].fillna("")

    if until_date is not None:
        cutoff = pd.Timestamp(until_date)
        players = players[players["GAME_DATE"] < cutoff].reset_index(drop=True)
        team_games = team_games[team_games["GAME_DATE"] < cutoff].reset_index(drop=True)

    # Staleness is judged as of the snapshot point so --until-date replays
    # behave exactly like a bootstrap run on that date would have.
    players = drop_stale_players(players, until_date or date.today())
    return players, team_games

"""Nightly production ingest: fetch one night's real games and score the model.

Pure synchronous pandas/nba_api code — no DB, no asyncio. The app layer
(app/services/model_nightly_service.py) orchestrates: it builds a FeatureStore
from rows *before* the night, calls ``evaluate_night`` (predictions therefore
use no data from the night itself), persists the results, then ingests the
night's raw rows.

``fetch_night`` also disambiguates a genuine off-night from nba_api lag via the
scoreboard: zero scheduled games is a done state, while missing/unfinal logs
mean "come back later".
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import date

import pandas as pd
from nba_api.stats.endpoints import playergamelogs, scoreboardv2, teamgamelogs

from ..research import config as rconfig
from ..research import data as rdata
from .feature_store import FeatureStore
from .inference import LiveInference, PredictionRequest
from .eval_row import EvalRow, _actual_line


def season_for(d: date) -> str:
    """NBA season string ("YYYY-YY") the given date belongs to (Aug+ = new season)."""
    start = d.year if d.month >= 8 else d.year - 1
    return f"{start}-{str(start + 1)[-2:]}"


@dataclass
class NightFetch:
    game_date: date
    player_games: pd.DataFrame   # cleaned player logs (regular season, MIN >= MIN_MINUTES)
    team_games: pd.DataFrame     # raw team logs (regular season; both teams of each game)
    expected_games: int          # regular-season games on the scoreboard for the date
    complete: bool               # all expected games final AND the logs cover them


def _fetch_one_day(endpoint_cls, game_date: date) -> pd.DataFrame:
    ds = game_date.strftime("%m/%d/%Y")
    df = endpoint_cls(
        season_nullable=season_for(game_date),
        season_type_nullable=rconfig.SEASON_TYPE,
        date_from_nullable=ds,
        date_to_nullable=ds,
        timeout=rdata.REQUEST_TIMEOUT,
    ).get_data_frames()[0]
    df.insert(0, "SEASON", season_for(game_date))
    time.sleep(rdata.SLEEP_BETWEEN_CALLS)
    return rdata._regular_season_only(rdata._to_datetime(df))


def _expected_regular_season_games(game_date: date) -> tuple[int, bool]:
    """(number of regular-season games scheduled on the date, all of them final)."""
    header = scoreboardv2.ScoreboardV2(
        game_date=game_date.strftime("%m/%d/%Y"), timeout=rdata.REQUEST_TIMEOUT
    ).game_header.get_data_frame()
    time.sleep(rdata.SLEEP_BETWEEN_CALLS)
    games = header[header["GAME_ID"].astype(str).str.startswith(rdata.REGULAR_SEASON_PREFIX)]
    all_final = bool((games["GAME_STATUS_ID"].astype(int) == 3).all()) if len(games) else True
    return len(games), all_final


def fetch_night(game_date: date) -> NightFetch:
    """Fetch one night's player + team logs and judge whether the data is complete."""
    expected, all_final = _expected_regular_season_games(game_date)
    if expected == 0:
        empty = pd.DataFrame()
        return NightFetch(game_date, empty, empty, 0, complete=True)

    player_games = _fetch_one_day(playergamelogs.PlayerGameLogs, game_date)
    team_games = _fetch_one_day(teamgamelogs.TeamGameLogs, game_date)

    # Same row filter as the research corpus: DNP / garbage-time rows are neither
    # targets nor history. (The per-player MIN_PLAYER_GAMES corpus filter does NOT
    # apply here — MIN_INFERENCE_GAMES gates eligibility at read time instead.)
    if not player_games.empty:
        player_games = player_games[
            player_games["MIN"].notna() & (player_games["MIN"] >= rconfig.MIN_MINUTES)
        ].reset_index(drop=True)

    complete = all_final and len(team_games) == 2 * expected and not player_games.empty
    return NightFetch(game_date, player_games, team_games, expected, complete)


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
    """Add each player's last-known POSITION from the store to nightly log rows.

    Nightly game logs carry no POSITION, and ``build_current_state`` takes the
    per-player last() — un-annotated rows would wipe positions on recompute.
    Brand-new players get "" (position flags 0) until the next roster refresh.
    """
    known = (
        store.players.dropna(subset=["POSITION"])
        .groupby("PLAYER_ID")["POSITION"].last()
        if "POSITION" in store.players.columns
        else pd.Series(dtype=str)
    )
    out = player_games.copy()
    out["POSITION"] = out["PLAYER_ID"].map(known).fillna("")
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


def bootstrap_frames(
    until_date: date | None = None, positions: pd.DataFrame | None = None
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Fetch and clean the full-history frames used to seed the Postgres store.

    Returns (player_games, team_games) for ``research/config.SEASONS``, with the
    same row filter as the nightly fetch. ``until_date`` (exclusive) trims the
    frames for mid-season replay testing. ``positions`` (PLAYER_ID -> POSITION)
    is fetched from team rosters when not supplied.
    """
    players = rdata._regular_season_only(rdata._to_datetime(rdata.fetch_player_logs(rconfig.SEASONS)))
    team_games = rdata._regular_season_only(rdata._to_datetime(rdata.fetch_team_logs(rconfig.SEASONS)))

    players = players[players["MIN"].notna() & (players["MIN"] >= rconfig.MIN_MINUTES)]
    players = players.sort_values(["PLAYER_ID", "GAME_DATE"]).reset_index(drop=True)

    if positions is None:
        positions = rdata.fetch_positions(rconfig.SEASONS)
    players = players.merge(positions, on="PLAYER_ID", how="left")
    players["POSITION"] = players["POSITION"].fillna("")

    if until_date is not None:
        cutoff = pd.Timestamp(until_date)
        players = players[players["GAME_DATE"] < cutoff].reset_index(drop=True)
        team_games = team_games[team_games["GAME_DATE"] < cutoff].reset_index(drop=True)

    # Staleness is judged as of the snapshot point so --until-date replays
    # behave exactly like a bootstrap run on that date would have.
    players = drop_stale_players(players, until_date or date.today())
    return players, team_games

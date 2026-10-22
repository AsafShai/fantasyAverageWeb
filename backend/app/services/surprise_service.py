"""Surprises of the night: score one night's player-games and serve them.

Runs right after the nightly job has ingested a night (model_nightly_service),
and can backfill by hand: one ingested night, or every night this season the
nightly processed before the step existed (or failed on):

    uv run python -m app.services.surprise_service --date YYYY-MM-DD
    uv run python -m app.services.surprise_service --missing

Inputs are all in Postgres already: fs_player_games (the night's lines plus
every player's history, for the z-scores) and model_eval_results (the model's
expectation for the minutes he actually played). The maths lives in
model_stats_inference/serving/surprise.py; the thresholds that decide who is
worth mentioning are server settings (SURPRISE_* in app/config.py).
"""

from __future__ import annotations

import asyncio
import gc
import json
import logging
import time
from datetime import date, datetime, timezone

import numpy as np
import pandas as pd

import httpx

from app.config import settings
from app.exceptions import DataSourceError
from app.services import schedule_service
from app.services.data_provider import get_data_provider
from app.services.db_service import DBService
from app.utils.constants import LINEUP_SLOT_MAP
from model_stats_inference.espn.teams import TEAM_ID_TO_ABBR
from model_stats_inference.serving import surprise

logger = logging.getLogger(__name__)

# The line stored and shown; turnovers play no part in the score and are left out.
_LINE_STATS = ["PTS", "REB", "AST", "FG3M", "STL", "BLK", "FGM", "FGA", "FTM", "FTA"]


NOT_STARTED_SLOTS = {"BE", "IR"}

# Read side, kept in memory between nightly runs: the nights list, the latest
# night and that night's response only change when the nightly writes (scored
# rows or a ledger row), which clears this. The expiry covers writes from
# another process (a manual backfill from the command line).
_READ_CACHE_TTL_S = 6 * 60 * 60
_MISS = object()
_read_cache: dict = {"ts": None, "values": {}}
# Bumped on every clear so a read that started before a write never stores
# what it read.
_read_generation = 0


def clear_surprise_read_cache() -> None:
    global _read_generation
    _read_generation += 1
    _read_cache.update({"ts": None, "values": {}})


def _cache_fresh() -> bool:
    ts = _read_cache["ts"]
    return ts is not None and time.monotonic() - ts < _READ_CACHE_TTL_S


def _cache_get(key: str):
    return _read_cache["values"].get(key, _MISS) if _cache_fresh() else _MISS


def _cache_put(key: str, value, generation: int) -> None:
    if generation != _read_generation:
        return
    if not _cache_fresh():
        _read_cache.update({"ts": time.monotonic(), "values": {}})
    _read_cache["values"][key] = value


async def fantasy_roster_for(game_date: date) -> dict[int, dict]:
    """{espn_player_id: {team_id, slot}} for the league's rosters on that night,
    from one ESPN request for that scoring period (period 1 = the season's first
    day). Only the few fields the row needs are kept; the ~1 MB payload is
    dropped. {} when the night is before the season or ESPN is unavailable: the
    rows then just carry no fantasy context."""
    season_start = await schedule_service.get_season_start_date() or settings.season_start
    period = (game_date - season_start).days + 1
    if period < 1:
        return {}
    url = (
        f"https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{settings.season_id}"
        f"/segments/0/leagues/{settings.league_id}"
    )
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(url, params=[("view", "mRoster"), ("view", "mTeam"), ("scoringPeriodId", str(period))])
            resp.raise_for_status()
            payload = resp.json()
    except Exception as e:
        logger.warning(f"Fantasy rosters for {game_date} (period {period}) unavailable: {type(e).__name__}: {e}")
        return {}
    if isinstance(payload, list):
        payload = payload[0] if payload else {}
    out = _parse_roster(payload)
    logger.info(
        f"Fantasy rosters for {game_date}: season {settings.season_id} period {period}, "
        f"{len(out)} rostered players"
    )
    return out


def _parse_roster(payload: dict) -> dict[int, dict]:
    # A team id means a different team in another season (ESPN reuses them), so
    # a payload for any season but ours must not tag the rows.
    if payload.get("seasonId") != settings.season_id:
        logger.warning(f"Fantasy rosters: got season {payload.get('seasonId')}, expected {settings.season_id}")
        return {}
    out: dict[int, dict] = {}
    for team in payload.get("teams", []):
        for entry in (team.get("roster") or {}).get("entries", []):
            pid = entry.get("playerId")
            if pid is not None:
                out[int(pid)] = {"team_id": team.get("id"), "slot": LINEUP_SLOT_MAP.get(entry.get("lineupSlotId"))}
    return out


def _verdict(score: float) -> str:
    if np.isnan(score):
        return ""
    if score >= settings.surprise_good_threshold:
        return "good"
    if score <= -settings.surprise_bad_threshold:
        return "bad"
    return ""


def score_night(
    history: pd.DataFrame, night_info: pd.DataFrame | None, evals: pd.DataFrame, game_date: date, calibration: dict
) -> pd.DataFrame:
    """Pure scoring of one night. ``history`` holds every played row up to and
    including the night, numeric columns only (uppercase, as
    fs_records_to_frame returns); ``night_info`` the night's rows' display
    fields (PLAYER_NAME, TEAM_ID, MATCHUP), which may already sit in
    ``history``; ``evals`` the night's model_eval_results rows (lowercase)."""
    night_mask = history["GAME_DATE"].dt.date == game_date
    night_ids = history.loc[night_mask, "PLAYER_ID"].unique()
    rows = history[history["PLAYER_ID"].isin(night_ids)]
    # Night-only z-scores: the same numbers compute_zscores gives at the last
    # row, without walking every row of the history (memory and time).
    z = surprise.night_zscores(rows, game_date)
    night = rows[night_mask & history["PLAYER_ID"].isin(night_ids)].merge(z, on=["PLAYER_ID", "GAME_ID"], how="left")
    if night_info is not None and not night_info.empty:
        info = night_info[["PLAYER_ID", "GAME_ID", "PLAYER_NAME", "TEAM_ID", "MATCHUP"]].copy()
        info["GAME_ID"] = info["GAME_ID"].astype(str)
        night["GAME_ID"] = night["GAME_ID"].astype(str)
        night = night.drop(columns=[c for c in ("PLAYER_NAME", "TEAM_ID", "MATCHUP") if c in night.columns])
        night = night.merge(info, on=["PLAYER_ID", "GAME_ID"], how="left")
    for col, default in (("PLAYER_NAME", ""), ("TEAM_ID", -1), ("MATCHUP", "")):
        if col not in night.columns:
            night[col] = default

    if not evals.empty:
        ev = evals.rename(columns={c: c.upper() for c in evals.columns})
        ev = ev[ev["ELIGIBLE"].astype(bool)]
        pred_cols = {f"PRED_{s}": f"PRED_{s}" for s in surprise.ERR_TARGETS}
        ev = ev[["PLAYER_ID", "GAME_ID", "OPPONENT_TEAM_ID", "IS_HOME"] + list(pred_cols)]
        ev["GAME_ID"] = ev["GAME_ID"].astype(str)
        night["GAME_ID"] = night["GAME_ID"].astype(str)
        night = night.merge(ev, on=["PLAYER_ID", "GAME_ID"], how="left")
    for s in surprise.ERR_TARGETS:
        if f"PRED_{s}" not in night.columns:
            night[f"PRED_{s}"] = np.nan
    night = surprise.add_errors(night)

    scores = surprise.score_frame(night, calibration)
    night = pd.concat([night, scores], axis=1)
    night["REASONS"] = surprise.reasons_for(night, scores, calibration)
    if night["MIN"].notna().any():
        night = night[night["MIN"] >= settings.surprise_min_minutes]
    return night.reset_index(drop=True)


def _opponent(row: pd.Series) -> tuple[int, bool]:
    """Opponent team id and home flag: from the eval row when it exists, else
    parsed from the ESPN matchup string ('BOS vs NYK' / 'BOS @ NYK')."""
    opp = row.get("OPPONENT_TEAM_ID")
    is_home = row.get("IS_HOME")
    matchup = str(row.get("MATCHUP", ""))
    if is_home is None or (isinstance(is_home, float) and np.isnan(is_home)):
        is_home = " vs" in matchup
    if opp is None or (isinstance(opp, float) and np.isnan(opp)):
        abbr = matchup.replace("@", " ").replace("vs", " ").split()
        from model_stats_inference.espn.teams import team_id_for_abbr
        opp = team_id_for_abbr(abbr[-1]) if abbr else None
        opp = -1 if opp is None else opp
    return int(opp), bool(is_home)


def _to_tuple(row: pd.Series, game_date: date, roster: dict[int, dict] | None = None) -> tuple:
    opp, is_home = _opponent(row)
    score = float(row["SCORE"]) if pd.notna(row["SCORE"]) else float("nan")
    owner = (roster or {}).get(int(row["PLAYER_ID"]))
    return (
        str(row["GAME_ID"]), int(row["PLAYER_ID"]), game_date, str(row.get("PLAYER_NAME", "")),
        int(row["TEAM_ID"]), opp, is_home, float(row["MIN"]),
        *[float(row[s]) for s in _LINE_STATS],
        None if pd.isna(row["METRIC_Z"]) else float(row["METRIC_Z"]),
        None if pd.isna(row["METRIC_ERR"]) else float(row["METRIC_ERR"]),
        None if np.isnan(score) else score,
        bool(row["HAS_ESTIMATE"]),
        _verdict(score),
        row["REASONS"],
        settings.season_id,
        owner["team_id"] if owner else None,
        owner["slot"] if owner else None,
    )


class SurpriseService:
    def __init__(self, db: DBService | None = None) -> None:
        # The nightly passes its own DBService so a test's fake DB stays in charge.
        self._db = db if db is not None else DBService()
        self._calibration: dict | None = None

    @property
    def calibration(self) -> dict:
        if self._calibration is None:
            self._calibration = surprise.load_calibration()
        return self._calibration

    async def compute_and_store(self, game_date: date) -> str:
        """Score an ingested night and upsert model_surprise_results."""
        db = self._db
        history, night_info, evals = await asyncio.gather(
            db.get_fs_player_rows_through(game_date),
            db.get_fs_night_rows(game_date),
            db.get_model_eval_for_date(game_date),
        )
        if history.empty or not (history["GAME_DATE"].dt.date == game_date).any():
            logger.warning(f"Surprises {game_date}: no ingested rows for that night")
            return "no_rows"
        evals_df = pd.DataFrame(evals)
        night = await asyncio.to_thread(score_night, history, night_info, evals_df, game_date, self.calibration)
        del history, night_info, evals, evals_df   # the step runs after the feature-store build; keep its peak low
        gc.collect()
        roster = await fantasy_roster_for(game_date)
        rows = [_to_tuple(r, game_date, roster) for _, r in night.iterrows()]
        written = await db.insert_model_surprise_rows(rows)
        clear_surprise_read_cache()
        if not written:
            return "db_write_failed"
        n_scored = int(night["SCORE"].notna().sum())
        n_good = int((night["SCORE"] >= settings.surprise_good_threshold).sum())
        n_bad = int((night["SCORE"] <= -settings.surprise_bad_threshold).sum())
        logger.info(
            f"Surprises {game_date}: {len(rows)} players, {n_scored} scored "
            f"({int(night['HAS_ESTIMATE'].sum())} with a model estimate), {n_good} good, {n_bad} bad"
        )
        return "processed"

    async def backfill_missing(self) -> dict[date, str]:
        """Score every night this season the nightly marked processed that has no
        surprise rows yet, oldest first; one status per night. Nothing is
        rescored, so it is safe to run any time."""
        season_start = await schedule_service.get_season_start_date() or settings.season_start
        nights = await self._db.get_unscored_processed_nights(season_start)
        if not nights:
            logger.info("Surprises backfill: every processed night is scored")
            return {}
        logger.info(f"Surprises backfill: {len(nights)} nights to score, {nights[0]} .. {nights[-1]}")
        results: dict[date, str] = {}
        for night in nights:
            try:
                results[night] = await self.compute_and_store(night)
            except Exception as e:
                logger.error(f"Surprises backfill {night}: {type(e).__name__}: {e}")
                results[night] = "failed"
        return results

    # --- read side ------------------------------------------------------------

    async def dates(self) -> list[str]:
        cached = _cache_get("dates")
        if cached is not _MISS:
            return list(cached)
        generation = _read_generation
        dates = [d.isoformat() for d in await self._db.get_surprise_dates()]
        _cache_put("dates", dates, generation)
        return list(dates)

    async def latest_date(self) -> date | None:
        cached = _cache_get("latest")
        if cached is not _MISS:
            return cached
        generation = _read_generation
        latest = await self._db.get_latest_surprise_date()
        _cache_put("latest", latest, generation)
        return latest

    async def night(self, game_date: date) -> dict | None:
        """One night's response. Only the latest night is kept in memory: it is
        what the page opens on, and older nights are rarely revisited."""
        cached = _cache_get("night")
        if cached is not _MISS and cached[0] == game_date:
            return cached[1]
        generation = _read_generation
        result = await self._build_night(game_date)
        if result is not None and _cache_get("latest") == game_date:
            _cache_put("night", (game_date, result), generation)
        return result

    async def _build_night(self, game_date: date) -> dict | None:
        rows = await self._db.get_surprises_for_date(game_date)
        if not rows:
            return None
        # Every scored row goes out, split by sign: the page filters with its own
        # sliders, starting from the server thresholds (the verdict on each row).
        scored = [r for r in rows if r["score"] is not None]
        abbrevs, names = await self._team_abbrevs(), await self._team_names()
        good = [self._row_out(r, abbrevs, names) for r in scored if r["score"] >= 0]
        bad = [self._row_out(r, abbrevs, names) for r in scored if r["score"] < 0]
        bad.sort(key=lambda r: r["score"])
        computed = max(r["updated_at"] for r in rows)
        # The nightly's newest ledger row, so the page can tell "no games last
        # night" (the ledger says no_games for a newer date) from "the night
        # hasn't been scored yet", without looking at the viewer's clock.
        run = await self._db.get_latest_model_nightly_run()
        latest_run = (
            {"game_date": run["game_date"].isoformat(), "status": run["status"]} if run else None
        )
        return {
            "latest_run": latest_run,
            "game_date": game_date.isoformat(),
            "games": len({r["game_id"] for r in rows}),
            "players_played": len(rows),
            "players_scored": sum(1 for r in rows if r["score"] is not None),
            "players_with_estimate": sum(1 for r in rows if r["has_estimate"]),
            "thresholds": {
                "good": settings.surprise_good_threshold,
                "bad": settings.surprise_bad_threshold,
            },
            "good": good,
            "bad": bad,
            "computed_at": (computed if computed.tzinfo else computed.replace(tzinfo=timezone.utc)).isoformat(),
        }

    async def period(self, start: date, end: date, good_pct: float, bad_pct: float) -> dict | None:
        """The booms and busts of a range of nights, ranked against each other:
        a boom is a player-night at or above the ``good_pct`` percentile of
        every scored player-night in the range, a bust at or below the
        ``100 - bad_pct`` percentile. One row per player-night."""
        summary, rows = await self._db.get_surprise_period(start, end, good_pct / 100, 1 - bad_pct / 100)
        if summary is None:
            return None
        abbrevs, names = await self._team_abbrevs(), await self._team_names()
        good = [self._row_out(r, abbrevs, names) for r in rows if r["score"] > 0]
        bad = sorted((self._row_out(r, abbrevs, names) for r in rows if r["score"] < 0), key=lambda r: r["score"])
        computed = summary["computed_at"]
        return {
            "start": start.isoformat(),
            "end": end.isoformat(),
            "nights": summary["nights"],
            "games": summary["games"],
            "players_played": summary["players_played"],
            "players_scored": summary["players_scored"],
            "players_with_estimate": summary["players_with_estimate"],
            "percentiles": {"good": good_pct, "bad": bad_pct},
            # the scores those percentiles fell on, both as magnitudes
            "thresholds": {"good": summary["good_cut"] or 0.0, "bad": abs(summary["bad_cut"] or 0.0)},
            "good": good,
            "bad": bad,
            "computed_at": (computed if computed.tzinfo else computed.replace(tzinfo=timezone.utc)).isoformat(),
        }

    @staticmethod
    async def _team_names() -> dict[int, str]:
        """Current season's fantasy team id -> full name ("Trust the process"),
        from the same cached standings as the codes, so a team that renames
        itself shows its new name. Best effort: the code when it fails."""
        try:
            return {int(t["team_id"]): t["team_name"] for t in await get_data_provider().get_team_names()}
        except DataSourceError:
            return {}

    @staticmethod
    async def _team_abbrevs() -> dict[int, str]:
        try:
            return await get_data_provider().get_team_abbrevs()
        except DataSourceError:
            return {}

    @staticmethod
    def _row_out(r: dict, abbrevs: dict[int, str], names: dict[int, str] | None = None) -> dict:
        reasons = r["reasons"]
        if isinstance(reasons, str):
            reasons = json.loads(reasons)
        # Rows scored under another season carry that season's team ids, which
        # name different teams now: show them without fantasy context.
        current = r.get("season_id") == settings.season_id
        team_id = r.get("fantasy_team_id") if current else None
        slot = r.get("lineup_slot") if current else None
        return {
            "game_date": r["game_date"].isoformat(),
            "player_id": r["player_id"],
            "player_name": r["player_name"],
            "team_abbr": TEAM_ID_TO_ABBR.get(r["team_id"], str(r["team_id"])),
            "opponent_abbr": TEAM_ID_TO_ABBR.get(r["opponent_team_id"], "?"),
            "is_home": r["is_home"],
            "minutes": r["minutes"],
            **{s.lower(): r[s.lower()] for s in _LINE_STATS},
            "score": r["score"],
            "metric_z": r["metric_z"],
            "metric_err": r["metric_err"],
            "has_estimate": r["has_estimate"],
            "verdict": r["verdict"],
            "reasons": reasons,
            # fantasy context that night: None = free agent
            "fantasy_team": abbrevs.get(team_id, str(team_id)) if team_id is not None else None,
            # The team's current full name, by the same season-scoped id.
            "fantasy_team_name": ((names or {}).get(team_id) or abbrevs.get(team_id)) if team_id is not None else None,
            "lineup_slot": slot,
            "started": (slot not in NOT_STARTED_SLOTS) if slot else None,
        }


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Score ingested nights' surprises")
    which = parser.add_mutually_exclusive_group(required=True)
    which.add_argument("--date", help="YYYY-MM-DD of an ingested night")
    which.add_argument("--missing", action="store_true",
                       help="every processed night this season without surprise rows")
    args = parser.parse_args()

    async def _main() -> str:
        try:
            svc = SurpriseService()
            if args.missing:
                done = await svc.backfill_missing()
                return "\n".join(f"{d}: {status}" for d, status in done.items()) or "nothing to score"
            return await svc.compute_and_store(date.fromisoformat(args.date))
        finally:
            await DBService().close()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    print(asyncio.run(_main()))

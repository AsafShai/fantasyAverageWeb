"""Surprises of the night: score one night's player-games and serve them.

Runs right after the nightly job has ingested a night (model_nightly_service),
and can backfill any ingested night by hand:

    uv run python -m app.services.surprise_service --date YYYY-MM-DD

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
from datetime import date, datetime, timezone

import numpy as np
import pandas as pd

from app.config import settings
from app.services.db_service import DBService
from model_stats_inference.espn.teams import TEAM_ID_TO_ABBR
from model_stats_inference.serving import surprise

logger = logging.getLogger(__name__)

# The line stored and shown; turnovers play no part in the score and are left out.
_LINE_STATS = ["PTS", "REB", "AST", "FG3M", "STL", "BLK", "FGM", "FGA", "FTM", "FTA"]


def _verdict(score: float) -> str:
    if np.isnan(score):
        return ""
    if score >= settings.surprise_good_threshold:
        return "good"
    if score <= -settings.surprise_bad_threshold:
        return "bad"
    return ""


def score_night(history: pd.DataFrame, evals: pd.DataFrame, game_date: date, calibration: dict) -> pd.DataFrame:
    """Pure scoring of one night. ``history`` holds every played row up to and
    including the night (uppercase columns, as fs_records_to_frame returns);
    ``evals`` the night's model_eval_results rows (lowercase columns)."""
    night_mask = history["GAME_DATE"].dt.date == game_date
    night_ids = history.loc[night_mask, "PLAYER_ID"].unique()
    rows = history[history["PLAYER_ID"].isin(night_ids)]
    # Night-only z-scores: the same numbers compute_zscores gives at the last
    # row, without walking every row of the history (memory and time).
    z = surprise.night_zscores(rows, game_date)
    night = rows[night_mask & history["PLAYER_ID"].isin(night_ids)].merge(z, on=["PLAYER_ID", "GAME_ID"], how="left")

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


def _to_tuple(row: pd.Series, game_date: date) -> tuple:
    opp, is_home = _opponent(row)
    score = float(row["SCORE"]) if pd.notna(row["SCORE"]) else float("nan")
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
        history, evals = await asyncio.gather(
            db.get_fs_player_rows_through(game_date),
            db.get_model_eval_for_date(game_date),
        )
        if history.empty or not (history["GAME_DATE"].dt.date == game_date).any():
            logger.warning(f"Surprises {game_date}: no ingested rows for that night")
            return "no_rows"
        evals_df = pd.DataFrame(evals)
        night = await asyncio.to_thread(score_night, history, evals_df, game_date, self.calibration)
        del history, evals, evals_df   # the step runs after the feature-store build; keep its peak low
        gc.collect()
        rows = [_to_tuple(r, game_date) for _, r in night.iterrows()]
        if not await db.insert_model_surprise_rows(rows):
            return "db_write_failed"
        n_scored = int(night["SCORE"].notna().sum())
        n_good = int((night["SCORE"] >= settings.surprise_good_threshold).sum())
        n_bad = int((night["SCORE"] <= -settings.surprise_bad_threshold).sum())
        logger.info(
            f"Surprises {game_date}: {len(rows)} players, {n_scored} scored "
            f"({int(night['HAS_ESTIMATE'].sum())} with a model estimate), {n_good} good, {n_bad} bad"
        )
        return "processed"

    # --- read side ------------------------------------------------------------

    async def dates(self) -> list[str]:
        return [d.isoformat() for d in await self._db.get_surprise_dates()]

    async def latest_date(self) -> date | None:
        dates = await self._db.get_surprise_dates()
        return dates[0] if dates else None

    async def night(self, game_date: date) -> dict | None:
        rows = await self._db.get_surprises_for_date(game_date)
        if not rows:
            return None
        # Every scored row goes out, split by sign: the page filters with its own
        # sliders, starting from the server thresholds (the verdict on each row).
        scored = [r for r in rows if r["score"] is not None]
        good = [self._row_out(r) for r in scored if r["score"] >= 0]
        bad = [self._row_out(r) for r in scored if r["score"] < 0]
        bad.sort(key=lambda r: r["score"])
        computed = max(r["created_at"] for r in rows)
        return {
            "game_date": game_date.isoformat(),
            "games": len({r["game_id"] for r in rows}),
            "players_played": len(rows),
            "players_scored": sum(1 for r in rows if r["score"] is not None),
            "players_with_estimate": sum(1 for r in rows if r["has_estimate"]),
            "thresholds": {
                "good": settings.surprise_good_threshold,
                "bad": settings.surprise_bad_threshold,
            },
            "max_rows": settings.surprise_top_n,
            "good": good,
            "bad": bad,
            "computed_at": (computed if computed.tzinfo else computed.replace(tzinfo=timezone.utc)).isoformat(),
        }

    @staticmethod
    def _row_out(r: dict) -> dict:
        reasons = r["reasons"]
        if isinstance(reasons, str):
            reasons = json.loads(reasons)
        return {
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
        }


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Score an ingested night's surprises")
    parser.add_argument("--date", required=True, help="YYYY-MM-DD of an ingested night")
    args = parser.parse_args()

    async def _main() -> str:
        try:
            return await SurpriseService().compute_and_store(date.fromisoformat(args.date))
        finally:
            await DBService().close()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    print(asyncio.run(_main()))

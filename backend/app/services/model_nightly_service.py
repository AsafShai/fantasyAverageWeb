"""Nightly model pipeline: fetch last night's games, retro-predict with real
minutes, persist predicted-vs-actual, and grow the Postgres-backed feature store.

The feature store's source of truth is the raw-row tables (fs_player_games /
fs_team_games); vectors are rebuilt in memory per run via FeatureStore.build().
Predictions for a night are computed from rows strictly before it, so they are
leakage-safe by construction. A model_nightly_runs ledger row per date makes the
9:00-11:00 scheduler retries no-ops after one success.

Manual runs:
    uv run python -m app.services.model_nightly_service --bootstrap [--until-date YYYY-MM-DD]
    uv run python -m app.services.model_nightly_service [--date YYYY-MM-DD] [--force]
"""

from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

import pandas as pd

from app.services.db_service import DBService
from model_stats_inference.research import config as rconfig
from model_stats_inference.research import data as rdata
from model_stats_inference.serving import nightly
from model_stats_inference.serving.feature_store import FeatureStore
from model_stats_inference.serving.inference import LiveInference
from model_stats_inference.serving.simulation import EvalRow

logger = logging.getLogger(__name__)

ISRAEL_TZ = ZoneInfo("Asia/Jerusalem")
CATCHUP_DAYS = 7

_EVAL_STATS = ["PTS", "REB", "AST", "FG3M", "STL", "BLK", "FGM", "FGA", "FTM", "FTA"]

# Column orders must match DBService.insert_fs_rows.
_FS_PLAYER_COLS = [
    "PLAYER_ID", "GAME_ID", "SEASON", "GAME_DATE", "PLAYER_NAME", "TEAM_ID",
    "MATCHUP", "POSITION", "MIN", "PTS", "REB", "OREB", "DREB", "AST", "FG3M",
    "FG3A", "STL", "BLK", "TOV", "FGM", "FGA", "FTM", "FTA", "PF", "PLUS_MINUS",
]
_FS_TEAM_COLS = [
    "TEAM_ID", "GAME_ID", "SEASON", "GAME_DATE", "TEAM_NAME", "MATCHUP",
    "PTS", "REB", "AST", "STL", "BLK", "FG3M", "FG_PCT", "FGA", "FTA", "TOV",
]


def _records_to_frame(records: list[dict]) -> pd.DataFrame:
    """DB rows (lowercase columns, date game_date) -> pipeline frame (uppercase,
    Timestamp GAME_DATE)."""
    df = pd.DataFrame.from_records(records)
    df.columns = [c.upper() for c in df.columns]
    df["GAME_DATE"] = pd.to_datetime(df["GAME_DATE"])
    return df


def _frame_to_tuples(df: pd.DataFrame, cols: list[str]) -> list[tuple]:
    out = []
    for row in df[cols].itertuples(index=False):
        vals = []
        for col, v in zip(cols, row):
            if col in ("PLAYER_ID", "TEAM_ID"):
                vals.append(int(v))
            elif col == "GAME_DATE":
                vals.append(pd.Timestamp(v).date())
            elif col in ("GAME_ID", "SEASON", "PLAYER_NAME", "TEAM_NAME", "MATCHUP", "POSITION"):
                vals.append("" if pd.isna(v) else str(v))
            else:
                vals.append(float(v))
        out.append(tuple(vals))
    return out


def _eval_to_tuple(ev: EvalRow, game_date: date) -> tuple:
    return (
        ev.game_id, ev.player_id, game_date, ev.player_name, ev.team_id,
        ev.opponent_team_id, ev.is_home, ev.real_minutes, ev.eligible, ev.reason,
        *[ev.predicted.get(s) if ev.eligible else None for s in _EVAL_STATS],
        *[float(ev.actual.get(s, 0.0)) for s in _EVAL_STATS],
    )


class ModelNightlyService:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._lock = asyncio.Lock()
            cls._instance._db = DBService()
        return cls._instance

    # --- morning entry point (called by the scheduler) ----------------------

    async def run_catchup(self) -> dict[str, str]:
        """Process every unprocessed date in the trailing window, oldest first.

        Stops at the first date that isn't in a terminal state (incomplete data,
        DB failure): ingesting later days before an earlier day would leave the
        store with a hole under those predictions.
        """
        yesterday = (datetime.now(ISRAEL_TZ) - timedelta(days=1)).date()
        statuses: dict[str, str] = {}
        for offset in range(CATCHUP_DAYS - 1, -1, -1):
            d = yesterday - timedelta(days=offset)
            status = await self.run_for_date(d)
            statuses[d.isoformat()] = status
            if status not in ("processed", "no_games", "already_processed", "store_already_ingested"):
                logger.warning(f"Model nightly catch-up stopped at {d}: {status}")
                break
        return statuses

    async def run_for_date(self, game_date: date, force: bool = False) -> str:
        async with self._lock:
            return await self._run_for_date(game_date, force)

    async def _run_for_date(self, game_date: date, force: bool) -> str:
        db = self._db
        if not force:
            run = await db.get_model_nightly_run(game_date)
            if run is not None:
                return "already_processed"

        # Leakage guard (unconditional, even with --force): once the night's rows
        # are in the store, a "prediction" for it would see its own outcome.
        has_date = await db.fs_has_date(game_date)
        if has_date is None:
            return "db_unavailable"
        if has_date:
            await db.upsert_model_nightly_run(game_date, "store_already_ingested", 0, 0)
            return "store_already_ingested"

        night = await asyncio.to_thread(nightly.fetch_night, game_date)
        if night.expected_games == 0:
            await db.upsert_model_nightly_run(game_date, "no_games", 0, 0)
            return "no_games"
        if not night.complete:
            logger.info(
                f"Night {game_date} not complete yet "
                f"(expected {night.expected_games} games); will retry next slot"
            )
            return "incomplete_data"

        player_recs, team_recs = await db.get_fs_rows_before(game_date)
        if not player_recs or not team_recs:
            logger.error("Feature-store tables are empty — run --bootstrap first")
            return "store_not_bootstrapped"

        evals, night_players = await asyncio.to_thread(
            self._predict_sync, player_recs, team_recs, night
        )

        eval_rows = [_eval_to_tuple(ev, game_date) for ev in evals]
        if not await db.insert_model_eval_rows(eval_rows):
            return "db_write_failed"

        if not await db.insert_fs_rows(
            _frame_to_tuples(night_players, _FS_PLAYER_COLS),
            _frame_to_tuples(night.team_games, _FS_TEAM_COLS),
        ):
            return "db_write_failed"

        await db.upsert_model_nightly_run(
            game_date, "processed", night.expected_games, len(eval_rows)
        )
        eligible = sum(1 for ev in evals if ev.eligible)
        logger.info(
            f"Model nightly {game_date}: {night.expected_games} games, "
            f"{len(eval_rows)} players evaluated ({eligible} eligible)"
        )
        return "processed"

    @staticmethod
    def _predict_sync(
        player_recs: list[dict], team_recs: list[dict], night: nightly.NightFetch
    ) -> tuple[list[EvalRow], pd.DataFrame]:
        """Heavy pandas/sklearn work, run in a thread: build the pre-night store,
        score the night, and annotate the night's player rows with positions."""
        players = _records_to_frame(player_recs).sort_values(["PLAYER_ID", "GAME_DATE"])
        team_games = _records_to_frame(team_recs)
        store = FeatureStore.build(
            players.reset_index(drop=True),
            rdata.build_team_allowed(team_games),
            rdata.build_team_own(team_games),
        )
        inference = LiveInference(store)
        evals = nightly.evaluate_night(store, inference, night)
        night_players = nightly.attach_positions(store, night.player_games)
        return evals, night_players

    # --- one-time init -------------------------------------------------------

    async def bootstrap(self, force: bool = False, until_date: Optional[date] = None) -> str:
        """Seed fs_player_games / fs_team_games from nba_api for research SEASONS."""
        async with self._lock:
            p_count, t_count = await self._db.fs_counts()
            if p_count or t_count:
                if not force:
                    logger.info(f"Store already bootstrapped ({p_count} player rows); use --force")
                    return "already_bootstrapped"
                # A forced re-bootstrap must replace, not append: inserts are
                # ON CONFLICT DO NOTHING, so leftover rows (e.g. stale players,
                # dropped seasons) would otherwise survive forever.
                if not await self._db.truncate_fs_tables():
                    return "db_write_failed"

            players, team_games = await asyncio.to_thread(
                nightly.bootstrap_frames, until_date, self._cached_positions()
            )
            logger.info(
                f"Bootstrap fetched {len(players)} player rows / {len(team_games)} team rows "
                f"for {', '.join(rconfig.SEASONS)}"
                + (f" (until {until_date})" if until_date else "")
            )
            ok = await self._db.insert_fs_rows(
                _frame_to_tuples(players, _FS_PLAYER_COLS),
                _frame_to_tuples(team_games, _FS_TEAM_COLS),
            )
            return "bootstrapped" if ok else "db_write_failed"

    @staticmethod
    def _cached_positions() -> Optional[pd.DataFrame]:
        """PLAYER_ID -> POSITION from the local research cache when present —
        skips the slow per-team roster crawl. None falls back to fetching."""
        path = rconfig.DATA_DIR / "players.parquet"
        if not path.exists():
            return None
        df = pd.read_parquet(path, columns=["PLAYER_ID", "POSITION"])
        return df.dropna().drop_duplicates("PLAYER_ID", keep="last")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Run the nightly model pipeline manually")
    parser.add_argument("--date", help="YYYY-MM-DD; default: yesterday (Asia/Jerusalem)")
    parser.add_argument("--force", action="store_true", help="ignore the runs ledger / bootstrap guard")
    parser.add_argument("--bootstrap", action="store_true", help="seed the feature-store tables")
    parser.add_argument("--until-date", help="bootstrap only rows before this date (YYYY-MM-DD)")
    args = parser.parse_args()

    async def _main() -> str:
        service = ModelNightlyService()
        try:
            if args.bootstrap:
                until = date.fromisoformat(args.until_date) if args.until_date else None
                return await service.bootstrap(force=args.force, until_date=until)
            d = (
                date.fromisoformat(args.date)
                if args.date
                else (datetime.now(ISRAEL_TZ) - timedelta(days=1)).date()
            )
            return await service.run_for_date(d, force=args.force)
        finally:
            await DBService().close()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    print(asyncio.run(_main()))

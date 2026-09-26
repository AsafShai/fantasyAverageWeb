import asyncio
import logging
import pandas as pd
from datetime import date, datetime
from zoneinfo import ZoneInfo

from app.config import settings
from app.services.db_service import DBService
from app.services.nba_stats_service import NBAStatsService
from app.services.team_slot_pace import get_team_slot_pace_df
from app.services.slot_games_estimator import SlotGamesEstimator

logger = logging.getLogger(__name__)

_NBA_AVG_PACE_FALLBACK = 65.9

# The scheduler fires on Israel time; "today" for the run-once-a-day cache
# must use the same calendar, not the server's (UTC) one.
ISRAEL_TZ = ZoneInfo("Asia/Jerusalem")


def israel_today(now: datetime | None = None) -> date:
    return (now or datetime.now(ISRAEL_TZ)).astimezone(ISRAEL_TZ).date()


class EstimatorService:
    _instance = None
    _initialized = False

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        if not EstimatorService._initialized:
            self.db_service = DBService()
            self._cache: dict | None = None
            self._cache_date: date | None = None
            # _cache_date is only set once the Monte Carlo finishes, so without
            # this every caller arriving mid-run would start its own run.
            self._run_lock = asyncio.Lock()
            EstimatorService._initialized = True

    async def _get_snapshot_df(self) -> pd.DataFrame:
        pool = await self.db_service._get_pool()
        if pool is None:
            raise RuntimeError("DB pool unavailable")
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT scoring_period_id, date, team_id, team_name,
                       gp, fgm, fga, fg_pct, ftm, fta, ft_pct,
                       three_pm, reb, ast, stl, blk, pts
                FROM team_daily_snapshot
                WHERE league_id = $1 AND season_id = $2
                ORDER BY team_id, scoring_period_id
                """,
                settings.league_id, settings.season_id,
            )
        if not rows:
            raise RuntimeError("No snapshot data in DB")
        df = pd.DataFrame([dict(r) for r in rows])
        df.insert(0, 'id', range(len(df)))
        df['created_at'] = datetime.now()
        return df

    async def _get_nba_avg_pace(self) -> float:
        try:
            nba_service = NBAStatsService()
            # NBAStatsService is a shared singleton (closed once at app
            # shutdown) — this runs concurrently with get_team_slot_pace_df's
            # own use of it via the same asyncio.gather, so closing here would
            # break whichever call is still in flight.
            pace = await nba_service.get_nba_average_pace(settings.season_id)
            if pace is not None:
                return pace
        except Exception as e:
            logger.warning(f"Failed to fetch NBA avg pace, using fallback: {e}")
        return _NBA_AVG_PACE_FALLBACK

    async def run_and_store(self, *, wait: bool = False) -> bool:
        """Run the estimator once per (Israel) day. If a run is already in
        flight, skip it (returns False) — or with wait=True, wait for that run
        and return whether it left today's results in place."""
        if self._run_lock.locked():
            if not wait:
                logger.info("Estimator run already in progress, skipping")
                return False
            async with self._run_lock:
                return self._cache_date == israel_today()
        async with self._run_lock:
            return await self._run_and_store_locked()

    async def _run_and_store_locked(self) -> bool:
        today = israel_today()

        if self._cache_date == today:
            logger.info("Estimator already ran today (cached), skipping")
            return False

        if await self.db_service.estimator_has_data(settings.league_id, settings.season_id):
            pool = await self.db_service._get_pool()
            if pool:
                async with pool.acquire() as conn:
                    stored_date = await conn.fetchval(
                        "SELECT as_of_date FROM estimator_prediction "
                        "WHERE league_id = $1 AND season_id = $2 LIMIT 1",
                        settings.league_id, settings.season_id,
                    )
                if stored_date == today:
                    logger.info("Estimator data already up to date for today, skipping")
                    return False

        try:
            df, nba_avg_pace, slot_pace_df = await asyncio.gather(
                self._get_snapshot_df(),
                self._get_nba_avg_pace(),
                get_team_slot_pace_df(),
            )
            slot_proj_df = SlotGamesEstimator().estimate(slot_pace_df)

            from app.fantsy_estimator import FantasyEstimator
            loop = asyncio.get_event_loop()
            prediction_df, ranking_df, rank_prob_df = await loop.run_in_executor(
                None, lambda: FantasyEstimator().estimate(df, nba_avg_pace, slot_proj_df)
            )

            await asyncio.gather(
                self.db_service.upsert_estimator_prediction(prediction_df, settings.league_id, settings.season_id),
                self.db_service.upsert_estimator_ranking(ranking_df, settings.league_id, settings.season_id),
                self.db_service.upsert_estimator_rank_probability(rank_prob_df, settings.league_id, settings.season_id),
            )

            self._cache = {
                "predictions": prediction_df.to_dict(orient='records'),
                "rankings": ranking_df.to_dict(orient='records'),
                "rank_probabilities": rank_prob_df.to_dict(orient='records'),
            }
            self._cache_date = today
            logger.info(
                f"Estimator run complete: {len(df)} snapshot rows in, {len(prediction_df)} predictions, "
                f"{len(ranking_df)} rankings out (nba_avg_pace={nba_avg_pace:.1f})"
            )
            return True

        except Exception as e:
            logger.error(f"Estimator run failed: {type(e).__name__}: {e}", exc_info=True)
            return False

    async def get_latest(self) -> dict | None:
        today = israel_today()
        if self._cache and self._cache_date == today:
            return self._cache

        result = await self.db_service.get_estimator_latest(settings.league_id, settings.season_id)
        if result.get("rankings"):
            self._cache = result
            predictions = result.get("predictions", [])
            as_of = predictions[0].get("as_of_date") if predictions else None
            if isinstance(as_of, date) and as_of == today:
                self._cache_date = today
            return result

        return None


def get_estimator_service() -> EstimatorService:
    return EstimatorService()

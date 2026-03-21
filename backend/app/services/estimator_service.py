import asyncio
import logging
import pandas as pd
from datetime import date, datetime

from app.config import settings
from app.services.db_service import DBService
from app.services.nba_stats_service import NBAStatsService

logger = logging.getLogger(__name__)

_NBA_AVG_PACE_FALLBACK = 65.9


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
                ORDER BY team_id, scoring_period_id
                """
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
            pace = await nba_service.get_nba_average_pace(settings.season_id)
            await nba_service.close()
            if pace is not None:
                return pace
        except Exception as e:
            logger.warning(f"Failed to fetch NBA avg pace, using fallback: {e}")
        return _NBA_AVG_PACE_FALLBACK

    async def run_and_store(self) -> bool:
        today = date.today()

        if self._cache_date == today:
            logger.info("Estimator already ran today (cached), skipping")
            return False

        if await self.db_service.estimator_has_data():
            pool = await self.db_service._get_pool()
            if pool:
                async with pool.acquire() as conn:
                    stored_date = await conn.fetchval(
                        "SELECT as_of_date FROM estimator_prediction LIMIT 1"
                    )
                if stored_date == today:
                    logger.info("Estimator data already up to date for today, skipping")
                    return False

        try:
            df = await self._get_snapshot_df()
            nba_avg_pace = await self._get_nba_avg_pace()

            from app.fantsy_estimator import FantasyEstimator
            loop = asyncio.get_event_loop()
            prediction_df, ranking_df, rank_prob_df = await loop.run_in_executor(
                None, lambda: FantasyEstimator().estimate(df, nba_avg_pace)
            )

            await asyncio.gather(
                self.db_service.upsert_estimator_prediction(prediction_df),
                self.db_service.upsert_estimator_ranking(ranking_df),
                self.db_service.upsert_estimator_rank_probability(rank_prob_df),
            )

            self._cache = {
                "predictions": prediction_df.to_dict(orient='records'),
                "rankings": ranking_df.to_dict(orient='records'),
                "rank_probabilities": rank_prob_df.to_dict(orient='records'),
            }
            self._cache_date = today
            logger.info("Estimator run complete")
            return True

        except Exception as e:
            logger.error(f"Estimator run failed: {e}")
            return False

    async def get_latest(self) -> dict | None:
        today = date.today()
        if self._cache and self._cache_date == today:
            return self._cache

        result = await self.db_service.get_estimator_latest()
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

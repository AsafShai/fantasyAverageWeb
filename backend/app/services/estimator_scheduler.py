import asyncio
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.services.estimator_service import EstimatorService
from app.services.data_provider import DataProvider

logger = logging.getLogger(__name__)

ISRAEL_TZ = ZoneInfo("Asia/Jerusalem")
SCHEDULE_TIMES = [(9, 0), (9, 30), (10, 0), (10, 30), (11, 0)]


def _compute_next_trigger() -> datetime:
    now = datetime.now(ISRAEL_TZ)
    for hour, minute in SCHEDULE_TIMES:
        candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if candidate > now:
            return candidate
    tomorrow = (now + timedelta(days=1)).replace(
        hour=SCHEDULE_TIMES[0][0], minute=SCHEDULE_TIMES[0][1], second=0, microsecond=0
    )
    return tomorrow


async def start_scheduler():
    service = EstimatorService()
    provider = DataProvider()
    logger.info("Estimator scheduler started")
    while True:
        next_trigger = _compute_next_trigger()
        now = datetime.now(ISRAEL_TZ)
        sleep_seconds = (next_trigger - now).total_seconds()
        logger.info(f"Estimator scheduler sleeping {sleep_seconds:.0f}s until {next_trigger.strftime('%H:%M')} IL")
        await asyncio.sleep(sleep_seconds)
        logger.info("Estimator scheduler triggered - syncing snapshot tables")
        synced = await provider.sync_db_now()
        if not synced:
            logger.info("Snapshot already current or ESPN unavailable, skipping estimator run")
            continue
        logger.info("Snapshot tables updated, running estimator")
        await service.run_and_store()

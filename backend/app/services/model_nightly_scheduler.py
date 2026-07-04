"""Morning scheduler for the nightly model pipeline.

Same retry-window pattern as estimator_scheduler: trigger at each slot between
9:00 and 11:00 Israel time (NBA games are final by ~8:00 IL). The pipeline's
model_nightly_runs ledger makes later slots no-ops once a night is processed,
so the extra slots only matter when nba_api data was late or a run failed.
"""

import asyncio
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.services.model_nightly_service import ModelNightlyService

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
    service = ModelNightlyService()
    logger.info("Model nightly scheduler started")
    while True:
        next_trigger = _compute_next_trigger()
        now = datetime.now(ISRAEL_TZ)
        sleep_seconds = (next_trigger - now).total_seconds()
        logger.info(
            f"Model nightly scheduler sleeping {sleep_seconds:.0f}s until "
            f"{next_trigger.strftime('%H:%M')} IL"
        )
        await asyncio.sleep(sleep_seconds)
        logger.info("Model nightly scheduler triggered")
        try:
            statuses = await service.run_catchup()
            logger.info(f"Model nightly catch-up finished: {statuses}")
        except Exception:
            logger.exception("Model nightly pipeline failed; will retry at next slot")

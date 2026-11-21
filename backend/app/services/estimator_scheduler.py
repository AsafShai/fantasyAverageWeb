import asyncio
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.services.estimator_service import EstimatorService, ISRAEL_TZ
from app.services.data_provider import DataProvider
from app.utils.request_context import start_job_run

logger = logging.getLogger(__name__)

# The snapshot and the estimator need ESPN's nightly rollover, which ESPN runs
# on New York time: the new scoring period showed up around 03:00 ET on every
# morning checked (Nov 2026 logs; 08:00-08:45 UTC). The slots are New York
# times so they follow it through both countries' clock changes. A slot after
# the morning's work is done costs one conditional ESPN request: the snapshot
# period known in memory tells both sync_db_now and the estimator there is
# nothing new, so the slot does not wake the database.
EASTERN = ZoneInfo("America/New_York")
SCHEDULE_TIMES = [(2, 30), (2, 45), (3, 0), (3, 15), (3, 30), (3, 45),
                  (4, 0), (4, 15), (4, 30), (4, 45), (5, 0)]


def _compute_next_trigger(now: datetime | None = None) -> datetime:
    now = (now or datetime.now(EASTERN)).astimezone(EASTERN)
    for day in (now.date(), now.date() + timedelta(days=1)):
        for hour, minute in SCHEDULE_TIMES:
            candidate = datetime(day.year, day.month, day.day, hour, minute, tzinfo=EASTERN)
            if candidate > now:
                return candidate
    raise AssertionError("unreachable: tomorrow always has a slot")


async def start_scheduler():
    service = EstimatorService()
    provider = DataProvider()
    logger.info("Estimator scheduler started")
    while True:
        next_trigger = _compute_next_trigger()
        sleep_seconds = max(0.0, (next_trigger - datetime.now(EASTERN)).total_seconds())
        logger.info(
            f"Estimator scheduler sleeping {sleep_seconds:.0f}s until {next_trigger.strftime('%H:%M')} ET "
            f"({next_trigger.astimezone(ISRAEL_TZ).strftime('%H:%M')} IL)"
        )
        await asyncio.sleep(sleep_seconds)
        start_job_run("estimator")
        logger.info("Estimator scheduler triggered - syncing snapshot tables")
        # The snapshot may already have been written by a page load since ESPN
        # rolled the period over, so run regardless of whether this sync wrote
        # anything: run_and_store itself skips when results cover the latest
        # snapshot. A failure must not end the loop — the next slot retries.
        try:
            await provider.sync_db_now()
            await service.run_and_store()
        except Exception as e:
            logger.error(f"Estimator scheduler run failed: {type(e).__name__}: {e}; will retry at next slot", exc_info=True)

"""Hourly check that each ADP provider gets a snapshot row for the current UTC day.

Providers publish on their own clocks -- Yahoo's daily ADP update lands hours after
midnight UTC -- so a single morning fetch can see yesterday's numbers and record
nothing. Each run re-fetches only the providers with no row for today yet (see
adp_service.ensure_daily_snapshot) and is a DB lookup only once they all have one.

It only runs while the process is awake; the external health cron keeps the Render
instance from sleeping.
"""

import asyncio
import logging

from app.services.adp_service import ensure_daily_snapshot

logger = logging.getLogger(__name__)

# Let startup (and test clients) settle before the first check.
INITIAL_DELAY_SECONDS = 120
INTERVAL_SECONDS = 3600


async def start_scheduler() -> None:
    logger.info("ADP snapshot scheduler started (hourly)")
    await asyncio.sleep(INITIAL_DELAY_SECONDS)
    while True:
        try:
            await ensure_daily_snapshot()
        except Exception as e:
            logger.warning("ADP snapshot check failed: %s: %s", type(e).__name__, e)
        await asyncio.sleep(INTERVAL_SECONDS)

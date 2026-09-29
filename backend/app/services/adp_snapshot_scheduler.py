"""Hourly ADP refresh that keeps the board and each day's snapshot current.

Providers publish on their own clocks -- Yahoo's daily ADP update lands hours after
midnight UTC -- so a once-a-day fetch leaves both up to a day behind. Each run re-fetches
ESPN, Fantrax and Yahoo (Sleeper stays once a day) and records any change as the current
UTC day's snapshot (see adp_service.ensure_daily_snapshot).
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

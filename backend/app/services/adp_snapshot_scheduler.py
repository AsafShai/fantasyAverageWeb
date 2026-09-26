"""Keeps ADP/rankings history ticking without waiting for a page view.

Provider payloads are only re-fetched when something asks for ADP data, so a quiet day
would leave a hole in the snapshot history. This loop asks every hour; the per-provider
24h cache (adp_cache.py) means it makes a network call only when a provider is actually
due, and each fresh payload is recorded by adp_snapshots on the way through.

It only runs while the process is awake; the existing external health cron keeps the
Render instance from sleeping.
"""

import asyncio
import logging

logger = logging.getLogger(__name__)

# Let startup (and test clients) settle before the first fetch.
INITIAL_DELAY_SECONDS = 120
INTERVAL_SECONDS = 3600


async def tick() -> None:
    from app.services.adp_service import get_adp_response

    await get_adp_response()


async def start_scheduler() -> None:
    logger.info("ADP snapshot scheduler started (hourly)")
    await asyncio.sleep(INITIAL_DELAY_SECONDS)
    while True:
        try:
            await tick()
        except Exception as e:
            logger.warning("ADP snapshot tick failed: %s: %s", type(e).__name__, e)
        await asyncio.sleep(INTERVAL_SECONDS)

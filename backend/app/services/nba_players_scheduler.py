"""Once-a-day refresh of the NBA players JSON catalog."""

import asyncio
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.services.nba_players_refresh import refresh_nba_players_json

logger = logging.getLogger(__name__)

ISRAEL_TZ = ZoneInfo("Asia/Jerusalem")
SCHEDULE_HOUR = 8
SCHEDULE_MINUTE = 0


def compute_next_trigger(now: datetime | None = None) -> datetime:
    current = now or datetime.now(ISRAEL_TZ)
    if current.tzinfo is None:
        current = current.replace(tzinfo=ISRAEL_TZ)
    else:
        current = current.astimezone(ISRAEL_TZ)
    candidate = current.replace(hour=SCHEDULE_HOUR, minute=SCHEDULE_MINUTE, second=0, microsecond=0)
    if candidate > current:
        return candidate
    return (current + timedelta(days=1)).replace(
        hour=SCHEDULE_HOUR, minute=SCHEDULE_MINUTE, second=0, microsecond=0
    )


async def start_scheduler() -> None:
    logger.info("NBA players refresh scheduler started (daily %02d:%02d IL)", SCHEDULE_HOUR, SCHEDULE_MINUTE)
    while True:
        next_trigger = compute_next_trigger()
        sleep_seconds = (next_trigger - datetime.now(ISRAEL_TZ)).total_seconds()
        logger.info(
            "NBA players refresh sleeping %.0fs until %s IL",
            sleep_seconds,
            next_trigger.strftime("%Y-%m-%d %H:%M"),
        )
        if sleep_seconds > 0:
            await asyncio.sleep(sleep_seconds)
        logger.info("NBA players refresh triggered")
        try:
            count = await refresh_nba_players_json()
            logger.info("NBA players refresh finished: %d players", count)
        except Exception as e:
            logger.error(
                "NBA players refresh failed: %s: %s; will retry tomorrow",
                type(e).__name__,
                e,
            )
            logger.exception("NBA players refresh failure traceback")

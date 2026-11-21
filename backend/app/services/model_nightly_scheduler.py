"""Scheduler for the nightly model pipeline: it wakes when the night's games
should be over, not at a fixed morning hour.

A night is the US Eastern date ESPN files its games under. For each night:

  * first attempt at the night's last tip-off + FIRST_CHECK_AFTER_LAST_TIP
    (a game runs ~2h15: the first check lands near the final buzzer, and
    the 15-minute retries pick up a game that runs longer);
  * while the night is not in the ledger yet (a game ran long, ESPN is late, a
    run failed), another attempt every RETRY_EVERY; an attempt before the
    deadline is skipped while the scoreboard still shows a game on, so it
    doesn't touch the database;
  * a final attempt at DEADLINE (04:00 ET the next morning, ~11:00 Israel) that
    always runs: one last try for a stuck night, and the second roster-stints
    rebuild of the day, for transactions filed after midnight ET.

A night without games gets one attempt at NO_GAMES_CHECK (it is recorded as
no_games) and the deadline attempt. When the scoreboard can't be read the
night falls back to attempts from FALLBACK_FIRST_CHECK on.

The plan is recomputed from a fresh scoreboard before every attempt and at
least every MAX_SLEEP, so a tip-off moved later pushes the attempt later. The
whole state is derived from the clock and the ledger, so a restart loses
nothing: an attempt that is already due runs STARTUP_DELAY after startup,
leaving the startup warm-ups to finish first. Each attempt is a catch-up
through that night; the ledger makes nights already processed no-ops.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from app.services.model_nightly_service import ModelNightlyService
from app.utils.request_context import start_job_run
from model_stats_inference.espn import client as espn_client
from model_stats_inference.espn import games as espn_games

logger = logging.getLogger(__name__)

EASTERN = ZoneInfo("America/New_York")

FIRST_CHECK_AFTER_LAST_TIP = timedelta(hours=2, minutes=15)
RETRY_EVERY = timedelta(minutes=15)
DEADLINE = time(4, 0)                 # ET, the morning after the night
NO_GAMES_CHECK = time(0, 15)          # ET, the morning after the night
FALLBACK_FIRST_CHECK = time(1, 30)    # ET, the morning after; scoreboard unreadable
STARTUP_DELAY = timedelta(minutes=3)
MAX_SLEEP = timedelta(hours=3)

# A night is done for the retries once it reaches one of these.
_NIGHT_DONE = {"processed", "no_games", "already_processed", "store_already_ingested"}

_next_trigger: Optional[datetime] = None


def next_trigger() -> Optional[datetime]:
    """When the scheduler next attempts a run (for /health); None before it plans."""
    return _next_trigger


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _eastern(day: date, at: time) -> datetime:
    return datetime.combine(day, at, tzinfo=EASTERN)


def night_for(now: datetime) -> date:
    """The night the scheduler works on at ``now``: the previous US date until
    its deadline (04:00 ET), then the current one."""
    local = now.astimezone(EASTERN)
    return local.date() - timedelta(days=1) if local.time() < DEADLINE else local.date()


@dataclass(frozen=True)
class NightPlan:
    night: date
    first_check: datetime
    deadline: datetime
    last_tip: Optional[datetime]
    source: str                       # "tip" | "no_games" | "fallback"


def plan_night(night: date, last_tip: Optional[datetime], scoreboard_ok: bool) -> NightPlan:
    deadline = _eastern(night + timedelta(days=1), DEADLINE)
    if not scoreboard_ok:
        first, source = _eastern(night + timedelta(days=1), FALLBACK_FIRST_CHECK), "fallback"
    elif last_tip is None:
        first, source = _eastern(night + timedelta(days=1), NO_GAMES_CHECK), "no_games"
    else:
        first, source = last_tip + FIRST_CHECK_AFTER_LAST_TIP, "tip"
    return NightPlan(night, min(first, deadline), deadline, last_tip, source)


def next_attempt(plan: NightPlan, done: bool, last_attempt: Optional[datetime]) -> datetime:
    """When to run next for ``plan``'s night (may be in the past: run now).

    Once the night is done only the deadline attempt is left; before that, the
    first check, then every RETRY_EVERY after the last attempt, never past the
    deadline."""
    if done:
        return plan.deadline
    if last_attempt is None:
        return plan.first_check
    return min(max(plan.first_check, last_attempt + RETRY_EVERY), plan.deadline)


def _read_last_tip(night: date) -> tuple[Optional[datetime], bool]:
    """(last tip-off, scoreboard read) for ``night``; blocking, run in a thread."""
    # Parsing is guarded too: one malformed event must not end the scheduler
    # loop; an unreadable scoreboard plans like an unavailable one.
    try:
        scoreboard = espn_client.scoreboard(night.strftime("%Y%m%d"))
        return espn_games.last_tip(scoreboard), True
    except Exception as e:
        logger.warning(f"Model nightly scheduler: scoreboard for {night} unavailable ({type(e).__name__}: {e})")
        return None, False


def _read_games_over(night: date) -> Optional[bool]:
    """Whether every expected game of ``night`` is final on the scoreboard;
    None when it can't be read. Blocking, run in a thread. Asked before a
    retry so that one made while games are still on costs an ESPN request
    instead of a catch-up, whose ledger reads wake the scale-to-zero database
    every 15 minutes."""
    try:
        scoreboard = espn_client.scoreboard(night.strftime("%Y%m%d"))
        return all(espn_games.is_final(e) for e in espn_games.expected_events(scoreboard))
    except Exception as e:
        logger.warning(f"Model nightly scheduler: scoreboard for {night} unavailable ({type(e).__name__}: {e})")
        return None


async def _plan(night: date) -> NightPlan:
    tip, ok = await asyncio.to_thread(_read_last_tip, night)
    return plan_night(night, tip, ok)


async def start_scheduler():
    global _next_trigger
    service = ModelNightlyService()
    started = _now()
    night = night_for(started)
    done = False
    last_attempt: Optional[datetime] = None
    logger.info(f"Model nightly scheduler started (night {night})")
    while True:
        plan = await _plan(night)
        when = max(next_attempt(plan, done, last_attempt), started + STARTUP_DELAY)
        is_final = when >= plan.deadline
        _next_trigger = when
        now = _now()
        if when > now:
            wait = min(when - now, MAX_SLEEP)
            what = "final attempt" if is_final else ("retry" if last_attempt else "first check")
            tip = plan.last_tip.astimezone(EASTERN).strftime("%H:%M ET") if plan.last_tip else "-"
            logger.info(
                f"Model nightly scheduler: night {night} ({plan.source}, last tip {tip}): "
                f"{what} at {when.astimezone(EASTERN).strftime('%Y-%m-%d %H:%M ET')}; "
                f"sleeping {wait.total_seconds():.0f}s"
            )
            await asyncio.sleep(wait.total_seconds())
            continue   # re-plan: a tip-off may have moved

        if not is_final and not done and plan.source == "tip":
            if await asyncio.to_thread(_read_games_over, night) is False:
                logger.info(f"Model nightly scheduler: night {night} still has games on; next check in 15 min")
                last_attempt = _now()
                continue

        start_job_run("model-nightly")
        logger.info(f"Model nightly scheduler triggered: night {night}{' (final attempt)' if is_final else ''}")
        last_attempt = _now()
        try:
            statuses = await service.run_catchup(through=night, final=is_final)
            logger.info(f"Model nightly catch-up finished: {statuses}")
            done = done or statuses.get(night.isoformat()) in _NIGHT_DONE
        except Exception as e:
            logger.exception(
                f"Model nightly pipeline failed: {type(e).__name__}: {e}; "
                f"{'moving on to the next night' if is_final else 'will retry'}"
            )
        if is_final:
            if not done:
                logger.error(
                    f"Model nightly: night {night} still not processed at its deadline; "
                    f"the following nights' catch-up retries it"
                )
            night, done, last_attempt = night + timedelta(days=1), False, None

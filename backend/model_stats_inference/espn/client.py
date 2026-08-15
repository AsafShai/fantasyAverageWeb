"""Thin HTTP client for ESPN's public site API (site.api.espn.com).

Synchronous requests with retries and polite pacing — the same shape the old
nba_api fetchers had, so callers (research bulk pull, nightly ingest) stay
simple. All endpoints are unauthenticated JSON GETs.
"""

from __future__ import annotations

import asyncio
import logging
import time

import httpx
import requests

logger = logging.getLogger(__name__)

BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"

REQUEST_TIMEOUT = 30
SLEEP_BETWEEN_CALLS = 0.15
RETRY_DELAYS = [2.0, 5.0, 15.0]

# No User-Agent override: ESPN's edge 403s browser-style UAs sent by a non-browser
# client (a Chrome UA without Chrome's TLS fingerprint reads as a bot), and 403s
# unrecognized custom UAs too. Library defaults (python-requests/*, python-httpx/*,
# curl/*) are served normally — so the honest default is the one that works. The
# async path already relies on httpx's default for the same reason.
HEADERS = {
    "Accept": "application/json",
}

_session = requests.Session()
_session.headers.update(HEADERS)


class EspnUnavailableError(RuntimeError):
    """ESPN kept failing after retries — treat like 'come back later'."""


def _status_and_body(e: Exception) -> tuple[int | None, str]:
    """Best-effort HTTP status code + a short response-body snippet from a
    requests/httpx exception, so a 403/429/5xx is greppable from the log line
    alone (the exception's own str() doesn't always include the body)."""
    resp = getattr(e, "response", None)
    if resp is None:
        return None, ""
    status = getattr(resp, "status_code", None)
    try:
        body = resp.text[:200]
    except Exception:
        body = ""
    return status, body


def get_json(path: str, params: dict | None = None) -> dict:
    url = f"{BASE}/{path}"
    attempts = len(RETRY_DELAYS) + 1
    last: Exception | None = None
    for attempt, delay in enumerate([0.0, *RETRY_DELAYS]):
        if delay:
            time.sleep(delay)
        try:
            resp = _session.get(url, params=params, timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()
            data = resp.json()
            time.sleep(SLEEP_BETWEEN_CALLS)
            return data
        except (requests.RequestException, ValueError) as e:
            last = e
            status, body = _status_and_body(e)
            logger.warning(
                f"ESPN GET {url} attempt {attempt + 1}/{attempts} failed (status={status}): "
                f"{type(e).__name__}: {e}" + (f" body={body!r}" if body else "")
            )
    logger.error(f"ESPN GET {url} gave up after {attempts} attempts: {type(last).__name__}: {last}")
    raise EspnUnavailableError(f"GET {url} failed after {attempts} attempts: {last}")


async def async_get_json(client: httpx.AsyncClient, path: str, params: dict | None = None) -> dict:
    """Async twin of ``get_json`` for FastAPI request-time callers (no
    SLEEP_BETWEEN_CALLS pacing — that's for the nightly bulk pull's hundreds
    of sequential requests, not a handful of per-request lookups)."""
    url = f"{BASE}/{path}"
    attempts = len(RETRY_DELAYS) + 1
    last: Exception | None = None
    for attempt, delay in enumerate([0.0, *RETRY_DELAYS]):
        if delay:
            await asyncio.sleep(delay)
        try:
            resp = await client.get(url, params=params, timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()
            return resp.json()
        except (httpx.HTTPError, ValueError) as e:
            last = e
            status, body = _status_and_body(e)
            logger.warning(
                f"ESPN GET {url} attempt {attempt + 1}/{attempts} failed (status={status}): "
                f"{type(e).__name__}: {e}" + (f" body={body!r}" if body else "")
            )
    logger.error(f"ESPN GET {url} gave up after {attempts} attempts: {type(last).__name__}: {last}")
    raise EspnUnavailableError(f"GET {url} failed after {attempts} attempts: {last}")


async def scoreboard_async(client: httpx.AsyncClient, dates: str) -> dict:
    """Scoreboard for a day ("YYYYMMDD") or a whole month ("YYYYMM"), async."""
    return await async_get_json(client, "scoreboard", {"dates": dates, "limit": 1000})


async def calendar_whitelist_async(client: httpx.AsyncClient) -> list[str]:
    """Every game day of the current season (ISO datetime strings, UTC) in one
    request — includes preseason/playoffs, not just regular season, so callers
    still need their own countability filter on the days they fetch."""
    data = await async_get_json(client, "scoreboard", {"calendartype": "whitelist"})
    return data["leagues"][0]["calendar"]


def scoreboard(dates: str) -> dict:
    """Scoreboard for a day ("YYYYMMDD") or a whole month ("YYYYMM")."""
    return get_json("scoreboard", {"dates": dates, "limit": 1000})


def calendar_whitelist() -> list[str]:
    """Sync twin of ``calendar_whitelist_async`` for the pure-sync nightly path."""
    data = get_json("scoreboard", {"calendartype": "whitelist"})
    return data["leagues"][0]["calendar"]


def game_summary(event_id: str) -> dict:
    """Full game summary (boxscore, header) for one event."""
    return get_json("summary", {"event": event_id})


def team_roster(team_id: int) -> dict:
    """Current roster (bio: height/weight/position) for one team."""
    return get_json(f"teams/{team_id}/roster")

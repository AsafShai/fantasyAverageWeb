"""Thin HTTP client for ESPN's public site API (site.api.espn.com).

Synchronous requests with retries and polite pacing — the same shape the old
nba_api fetchers had, so callers (research bulk pull, nightly ingest) stay
simple. All endpoints are unauthenticated JSON GETs.
"""

from __future__ import annotations

import time

import requests

BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"

REQUEST_TIMEOUT = 30
SLEEP_BETWEEN_CALLS = 0.15
_RETRY_DELAYS = [2.0, 5.0, 15.0]

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
}

_session = requests.Session()
_session.headers.update(_HEADERS)


class EspnUnavailableError(RuntimeError):
    """ESPN kept failing after retries — treat like 'come back later'."""


def get_json(path: str, params: dict | None = None) -> dict:
    url = f"{BASE}/{path}"
    last: Exception | None = None
    for attempt, delay in enumerate([0.0, *_RETRY_DELAYS]):
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
    raise EspnUnavailableError(f"GET {url} failed after {len(_RETRY_DELAYS) + 1} attempts: {last}")


def scoreboard(dates: str) -> dict:
    """Scoreboard for a day ("YYYYMMDD") or a whole month ("YYYYMM")."""
    return get_json("scoreboard", {"dates": dates, "limit": 1000})


def game_summary(event_id: str) -> dict:
    """Full game summary (boxscore, header) for one event."""
    return get_json("summary", {"event": event_id})


def team_roster(team_id: int) -> dict:
    """Current roster (bio: height/weight/position) for one team."""
    return get_json(f"teams/{team_id}/roster")

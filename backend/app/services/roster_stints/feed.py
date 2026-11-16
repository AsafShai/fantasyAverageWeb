"""The NBA Player Movement feed: every signing, waiver, trade, claim and contract
conversion since July 2015, as one static JSON file.

It is a plain file on Akamai storage, not the stats.nba.com API, and downloads
from Render with default httpx headers (checked with /health?probe=nba_movement
in Nov 2026). Rows carry NBA ids, so teams are mapped to ESPN ids here and
players are mapped by name in matching.py.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import date

import httpx

from app.utils.ssl_context import shared_ssl_context

logger = logging.getLogger(__name__)

FEED_URL = "https://stats.nba.com/js/data/playermovement/NBA_Player_Movement.json"
RETRY_DELAYS = (2.0, 6.0, 15.0)

# The feed's TEAM_SLUG -> ESPN team id (model_stats_inference/espn/teams.py).
NBA_SLUG_TO_ESPN_TEAM: dict[str, int] = {
    "hawks": 1, "celtics": 2, "pelicans": 3, "bulls": 4, "cavaliers": 5,
    "mavericks": 6, "nuggets": 7, "pistons": 8, "warriors": 9, "rockets": 10,
    "pacers": 11, "clippers": 12, "lakers": 13, "heat": 14, "bucks": 15,
    "timberwolves": 16, "nets": 17, "knicks": 18, "magic": 19, "sixers": 20,
    "suns": 21, "blazers": 22, "kings": 23, "spurs": 24, "thunder": 25,
    "jazz": 26, "wizards": 27, "raptors": 28, "grizzlies": 29, "hornets": 30,
}

# Transaction_Type values the replay understands. Anything else is ignored.
SIGNING = "Signing"
WAIVE = "Waive"
TRADE = "Trade"
CONVERTED = "ContractConverted"
CLAIMED = "AwardOnWaivers"


@dataclass(frozen=True)
class FeedRow:
    day: date
    kind: str            # one of the constants above
    team_id: int         # ESPN team id
    nba_player_id: int
    player_slug: str     # e.g. "christopher-cenac-jr"
    description: str
    order: str           # GroupSort, a stable tie-break within a day


class FeedUnavailable(Exception):
    pass


def parse_feed(payload: dict) -> list[FeedRow]:
    """Rows that name a player and a known team, oldest first. Draft picks and
    cash considerations carry no player and are dropped."""
    out: list[FeedRow] = []
    for r in payload["NBA_Player_Movement"]["rows"]:
        pid = r.get("PLAYER_ID")
        team = NBA_SLUG_TO_ESPN_TEAM.get(str(r.get("TEAM_SLUG") or ""))
        if not pid or team is None:
            continue
        try:
            day = date.fromisoformat(str(r["TRANSACTION_DATE"])[:10])
        except (KeyError, ValueError):
            continue
        out.append(FeedRow(
            day=day,
            kind=str(r.get("Transaction_Type") or ""),
            team_id=team,
            nba_player_id=int(pid),
            player_slug=str(r.get("PLAYER_SLUG") or ""),
            description=str(r.get("TRANSACTION_DESCRIPTION") or ""),
            order=str(r.get("GroupSort") or ""),
        ))
    out.sort(key=lambda x: (x.day, x.order))
    return out


async def fetch_feed() -> list[FeedRow]:
    last: Exception | None = None
    for delay in (0.0, *RETRY_DELAYS):
        if delay:
            await asyncio.sleep(delay)
        try:
            async with httpx.AsyncClient(timeout=30.0, verify=shared_ssl_context()) as client:
                resp = await client.get(FEED_URL, follow_redirects=True)
            resp.raise_for_status()
            rows = parse_feed(resp.json())
            if not rows:
                raise ValueError("feed parsed to zero rows")
            return rows
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as e:
            last = e
            logger.warning(f"NBA movement feed fetch failed: {type(e).__name__}: {e}")
    raise FeedUnavailable(f"{type(last).__name__}: {last}")

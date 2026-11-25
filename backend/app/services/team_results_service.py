"""Final scores of one NBA team's games this season.

The season schedule (schedule_service) comes from ESPN's fantasy feed, which
has no scores. This reads the team's ESPN schedule instead, keeps the games
that are over and caches them briefly per team: a result only changes when a
game ends, and the NBA Teams page asks for one team at a time.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

import httpx

from app.utils.ssl_context import shared_ssl_context
from model_stats_inference.espn import client as espn_client
from model_stats_inference.espn.games import event_game_date
from model_stats_inference.espn.teams import TEAM_ID_TO_ABBR, TEAM_IDS

CACHE_TTL_SECONDS = 10 * 60
REGULAR_SEASON = 2

_cache: dict[int, tuple[float, list[dict[str, Any]]]] = {}
_lock = asyncio.Lock()


class UnknownTeam(ValueError):
    pass


def _score(competitor: dict[str, Any]) -> int | None:
    raw = competitor.get("score")
    if isinstance(raw, dict):
        raw = raw.get("value", raw.get("displayValue"))
    try:
        return int(float(raw))
    except (TypeError, ValueError):
        return None


def parse_team_results(payload: dict[str, Any], team_id: int) -> list[dict[str, Any]]:
    """Finished games from an ESPN `teams/{id}/schedule` payload, in date order."""
    results: list[dict[str, Any]] = []
    for event in payload.get("events") or []:
        try:
            competition = event["competitions"][0]
            status = (competition.get("status") or {}).get("type") or {}
            if not (status.get("completed") or status.get("state") == "post"):
                continue
            competitors = competition.get("competitors") or []
            mine = next(c for c in competitors if int(c["team"]["id"]) == team_id)
            other = next(c for c in competitors if int(c["team"]["id"]) != team_id)
            opponent_id = int(other["team"]["id"])
            game_date = event_game_date(event)
        except (KeyError, IndexError, StopIteration, TypeError, ValueError):
            continue
        team_score, opponent_score = _score(mine), _score(other)
        if team_score is None or opponent_score is None:
            continue
        results.append({
            "game_id": str(event.get("id", "")),
            "date": game_date.isoformat(),
            "is_home": mine.get("homeAway") == "home",
            "opponent_id": opponent_id,
            "opponent_abbreviation": TEAM_ID_TO_ABBR.get(opponent_id, str(other["team"].get("abbreviation", ""))),
            "team_score": team_score,
            "opponent_score": opponent_score,
            "won": team_score > opponent_score,
        })
    results.sort(key=lambda row: (row["date"], row["game_id"]))
    return results


async def get_team_results(team_id: int) -> list[dict[str, Any]]:
    """This season's finished games for one team (ESPN pro team id)."""
    if team_id not in TEAM_IDS:
        raise UnknownTeam(f"Unknown NBA team {team_id}")
    cached = _cache.get(team_id)
    if cached and time.monotonic() - cached[0] < CACHE_TTL_SECONDS:
        return cached[1]
    async with _lock:
        cached = _cache.get(team_id)
        if cached and time.monotonic() - cached[0] < CACHE_TTL_SECONDS:
            return cached[1]
        async with httpx.AsyncClient(verify=shared_ssl_context()) as client:
            payload = await espn_client.async_get_json(client, f"teams/{team_id}/schedule", {"seasontype": REGULAR_SEASON})
        results = parse_team_results(payload, team_id)
        _cache[team_id] = (time.monotonic(), results)
        return results


def clear_cache() -> None:
    _cache.clear()

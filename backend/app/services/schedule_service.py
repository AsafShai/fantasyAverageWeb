"""Forward NBA schedule data used by the schedule views.

The schedule is small enough to rebuild from ESPN in seven monthly requests,
so it stays an in-process cache rather than becoming another database dataset.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

import httpx

from app.config import settings
from model_stats_inference.espn import client as espn_client
from model_stats_inference.espn.games import event_game_date, is_countable, season_months
from model_stats_inference.espn.teams import TEAM_ID_TO_ABBR, TEAM_ID_TO_NAME, TEAM_IDS

HIGH_VOLUME_THRESHOLD = 10
CACHE_TTL_SECONDS = 24 * 60 * 60


@dataclass(frozen=True)
class ScheduledGame:
    game_id: str
    game_date: date
    opponent_id: int
    is_home: bool


@dataclass(frozen=True)
class ScheduleCacheEntry:
    season: str
    fetched_at: float
    payload: dict[str, Any]


_cache: dict[str, ScheduleCacheEntry] = {}
_cache_lock = asyncio.Lock()


def season_label(season_id: int | None = None) -> str:
    configured_id = settings.season_id if season_id is None else season_id
    start_year = configured_id - 1
    return f"{start_year}-{str(start_year + 1)[-2:]}"


def invalidate_schedule_cache(season: str | None = None) -> None:
    """Force the next request to rebuild one season or all cached seasons."""
    if season is None:
        _cache.clear()
    else:
        _cache.pop(season, None)


def _event_teams(event: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]] | None:
    try:
        competitors = event["competitions"][0]["competitors"]
        if len(competitors) != 2:
            return None
        first, second = competitors
        first_id = int(first["team"]["id"])
        second_id = int(second["team"]["id"])
    except (KeyError, TypeError, ValueError):
        return None
    if first_id not in TEAM_IDS or second_id not in TEAM_IDS:
        return None
    return first, second


def _extract_games(scoreboards: list[dict[str, Any]]) -> dict[int, list[ScheduledGame]]:
    games_by_team: dict[int, list[ScheduledGame]] = {team_id: [] for team_id in TEAM_IDS}
    seen_game_ids: set[str] = set()

    for scoreboard in scoreboards:
        for event in scoreboard.get("events", []):
            game_id = str(event.get("id", ""))
            if not game_id or game_id in seen_game_ids or not is_countable(event):
                continue
            teams = _event_teams(event)
            if teams is None:
                continue
            first, second = teams
            try:
                first_id = int(first["team"]["id"])
                second_id = int(second["team"]["id"])
                game_date = event_game_date(event)
            except (KeyError, TypeError, ValueError):
                continue

            seen_game_ids.add(game_id)
            first_home = first.get("homeAway") == "home"
            second_home = second.get("homeAway") == "home"
            games_by_team[first_id].append(ScheduledGame(game_id, game_date, second_id, first_home))
            games_by_team[second_id].append(ScheduledGame(game_id, game_date, first_id, second_home))

    for games in games_by_team.values():
        games.sort(key=lambda game: (game.game_date, game.game_id))
    return games_by_team


def _date_bounds(games_by_team: dict[int, list[ScheduledGame]]) -> tuple[date, date] | None:
    dates = [game.game_date for games in games_by_team.values() for game in games]
    if not dates:
        return None
    return min(dates), max(dates)


def _build_payload(season: str, games_by_team: dict[int, list[ScheduledGame]]) -> dict[str, Any]:
    all_game_dates = sorted({game.game_date for games in games_by_team.values() for game in games})
    slate_sizes = {game_date: 0 for game_date in all_game_dates}
    for games in games_by_team.values():
        for game in games:
            slate_sizes[game.game_date] += 1
    slate_sizes = {game_date: count // 2 for game_date, count in slate_sizes.items()}

    bounds = _date_bounds(games_by_team)
    calendar_days: list[dict[str, Any]] = []
    if bounds is not None:
        current = bounds[0]
        while current <= bounds[1]:
            slate_size = slate_sizes.get(current, 0)
            calendar_days.append({
                "date": current.isoformat(),
                "slate_size": slate_size,
                "high_volume": slate_size >= HIGH_VOLUME_THRESHOLD,
            })
            current += timedelta(days=1)

    months = [10, 11, 12, 1, 2, 3, 4]
    month_labels = ["October", "November", "December", "January", "February", "March", "April"]
    teams: list[dict[str, Any]] = []

    for team_id in sorted(TEAM_IDS):
        games = games_by_team[team_id]
        rest_days: list[int] = []
        game_rows: list[dict[str, Any]] = []
        previous_date: date | None = None
        for game in games:
            rest = None if previous_date is None else max(0, (game.game_date - previous_date).days - 1)
            if rest is not None:
                rest_days.append(rest)
            slate_size = slate_sizes[game.game_date]
            game_rows.append({
                "game_id": game.game_id,
                "date": game.game_date.isoformat(),
                "opponent_id": game.opponent_id,
                "opponent": TEAM_ID_TO_NAME[game.opponent_id],
                "opponent_abbreviation": TEAM_ID_TO_ABBR[game.opponent_id],
                "is_home": game.is_home,
                "rest_days": rest,
                "slate_size": slate_size,
                "high_volume": slate_size >= HIGH_VOLUME_THRESHOLD,
            })
            previous_date = game.game_date

        monthly_games = {
            label: sum(1 for game in games if game.game_date.month == month)
            for month, label in zip(months, month_labels)
        }
        high_volume_games = sum(1 for game in games if slate_sizes[game.game_date] >= HIGH_VOLUME_THRESHOLD)
        teams.append({
            "team_id": team_id,
            "abbreviation": TEAM_ID_TO_ABBR[team_id],
            "team_name": TEAM_ID_TO_NAME[team_id],
            "games": game_rows,
            "monthly_games": monthly_games,
            "total_games": len(games),
            "b2b_count": sum(rest == 0 for rest in rest_days),
            "high_volume_games": high_volume_games,
            "avg_rest_days": round(sum(rest_days) / len(rest_days), 2) if rest_days else None,
        })

    published_counts = [team["total_games"] for team in teams]
    return {
        "season": season,
        "high_volume_threshold": HIGH_VOLUME_THRESHOLD,
        "calendar_days": calendar_days,
        "teams": teams,
        "published_games_min": min(published_counts) if published_counts else 0,
        "published_games_max": max(published_counts) if published_counts else 0,
    }


async def _fetch_schedule(season: str) -> dict[str, Any]:
    async with httpx.AsyncClient() as client:
        scoreboards = await asyncio.gather(*(
            espn_client.scoreboard_async(client, month)
            for month in season_months(season)
        ))
    return _build_payload(season, _extract_games(scoreboards))


async def get_schedule(season: str | None = None) -> dict[str, Any]:
    season = season or season_label()
    now = time.monotonic()
    cached = _cache.get(season)
    if cached is not None and now - cached.fetched_at < CACHE_TTL_SECONDS:
        return cached.payload

    async with _cache_lock:
        now = time.monotonic()
        cached = _cache.get(season)
        if cached is not None and now - cached.fetched_at < CACHE_TTL_SECONDS:
            return cached.payload
        payload = await _fetch_schedule(season)
        _cache[season] = ScheduleCacheEntry(season, time.monotonic(), payload)
        return payload

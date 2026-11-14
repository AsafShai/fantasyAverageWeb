"""Past-season per-game averages for one NBA player, from ESPN's public
athlete stats endpoint (the same data as the "Stats" tab on espn.com).

ESPN returns the player's whole career, one row per season per team, plus a
"<season> Totals" row (no teamId) when the player was traded mid-season. We
keep one row per season — the Totals row when there is one — and list the
teams he played for that year.
"""
import logging
import time
from typing import Optional

import httpx

from app.models.nba_player_models import PlayerSeasonLine, PlayerSeasonHistoryResponse
from app.utils.ssl_context import shared_ssl_context

logger = logging.getLogger(__name__)

_STATS_URL = "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/{athlete_id}/stats"
_TTL_S = 12 * 3600
_MAX_CACHE = 2000


class SeasonHistoryFetchError(Exception):
    pass


def _num(value: Optional[str]) -> Optional[float]:
    if value is None or value in ("", "-", "--"):
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _pair(value: Optional[str]) -> tuple[Optional[float], Optional[float]]:
    """'9.6-17.9' -> (9.6, 17.9)."""
    if not value or "-" not in value:
        return None, None
    made, _, att = value.partition("-")
    return _num(made), _num(att)


def _pct(value: Optional[str]) -> Optional[float]:
    n = _num(value)
    return None if n is None else round(n / 100.0, 4)


def parse_season_history(data: dict, current_season: int, limit: int) -> list[PlayerSeasonLine]:
    """Turn ESPN's career payload into the last `limit` completed regular
    seasons (newest first), skipping `current_season` and anything later."""
    averages = next((c for c in data.get("categories", []) if c.get("name") == "averages"), None)
    if not averages:
        return []
    names: list[str] = averages.get("names") or []
    teams_by_slug = {slug: t.get("abbreviation", "") for slug, t in (data.get("teams") or {}).items()}

    by_year: dict[int, dict] = {}
    for row in averages.get("statistics", []):
        year = (row.get("season") or {}).get("year")
        if not isinstance(year, int) or year >= current_season:
            continue
        entry = by_year.setdefault(
            year, {"label": row["season"].get("displayName", str(year)), "teams": [], "row": None, "is_total": False}
        )
        is_total = row.get("teamId") is None
        if not is_total:
            abbr = teams_by_slug.get(row.get("teamSlug", ""), "")
            if abbr and abbr not in entry["teams"]:
                entry["teams"].append(abbr)
        # Prefer the combined Totals row; otherwise the (only) team row.
        if entry["row"] is None or (is_total and not entry["is_total"]):
            entry["row"] = row
            entry["is_total"] = is_total

    lines: list[PlayerSeasonLine] = []
    for year in sorted(by_year, reverse=True)[:limit]:
        entry = by_year[year]
        stats = dict(zip(names, entry["row"].get("stats", [])))
        fgm, fga = _pair(stats.get("avgFieldGoalsMade-avgFieldGoalsAttempted"))
        ftm, fta = _pair(stats.get("avgFreeThrowsMade-avgFreeThrowsAttempted"))
        tpm, tpa = _pair(stats.get("avgThreePointFieldGoalsMade-avgThreePointFieldGoalsAttempted"))
        lines.append(PlayerSeasonLine(
            season=year,
            season_label=entry["label"],
            teams=entry["teams"],
            gp=int(_num(stats.get("gamesPlayed")) or 0),
            gs=int(_num(stats.get("gamesStarted")) or 0),
            minutes=_num(stats.get("avgMinutes")),
            fgm=fgm, fga=fga, fg_percentage=_pct(stats.get("fieldGoalPct")),
            ftm=ftm, fta=fta, ft_percentage=_pct(stats.get("freeThrowPct")),
            three_pm=tpm, three_pa=tpa,
            reb=_num(stats.get("avgRebounds")),
            ast=_num(stats.get("avgAssists")),
            stl=_num(stats.get("avgSteals")),
            blk=_num(stats.get("avgBlocks")),
            to=_num(stats.get("avgTurnovers")),
            pts=_num(stats.get("avgPoints")),
        ))
    return lines


class PlayerSeasonHistoryService:
    """Singleton with a 12h per-player cache — past seasons don't change."""

    _instance = None
    _initialized = False

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self) -> None:
        if not PlayerSeasonHistoryService._initialized:
            self._client = httpx.AsyncClient(timeout=15.0, verify=shared_ssl_context())
            self._cache: dict[int, tuple[float, dict]] = {}
            PlayerSeasonHistoryService._initialized = True

    async def _fetch(self, athlete_id: int) -> dict:
        cached = self._cache.get(athlete_id)
        if cached is not None and time.monotonic() - cached[0] < _TTL_S:
            return cached[1]
        try:
            resp = await self._client.get(_STATS_URL.format(athlete_id=athlete_id))
        except httpx.HTTPError as e:
            logger.error("ESPN season history fetch failed for %s: %s: %s", athlete_id, type(e).__name__, e)
            raise SeasonHistoryFetchError(str(e)) from e
        if resp.status_code == 404:
            data: dict = {}
        elif resp.status_code != 200:
            logger.error("ESPN season history for %s returned HTTP %s", athlete_id, resp.status_code)
            raise SeasonHistoryFetchError(f"HTTP {resp.status_code}")
        else:
            data = resp.json()
        if len(self._cache) >= _MAX_CACHE:
            self._cache.clear()
        self._cache[athlete_id] = (time.monotonic(), data)
        return data

    async def get_history(self, athlete_id: int, current_season: int, limit: int = 4) -> PlayerSeasonHistoryResponse:
        data = await self._fetch(athlete_id)
        return PlayerSeasonHistoryResponse(
            player_id=athlete_id,
            seasons=parse_season_history(data, current_season, limit),
        )

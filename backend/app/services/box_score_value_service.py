"""One slate's player values: a z-score per player line, against every other
line on the same slate, and the fantasy team that owned him that night.

The z is the usual fantasy one over the league's own scoring categories, but
the population is the night's box scores, not a season: each counting stat is
(x - mean) / std across every player who played that day, a percentage is the
same over its volume-weighted impact (makes - slate rate * attempts), and a
reverse category (turnovers) counts negative. The line's value is the mean
across categories, the same scale as the stint Z-score (stint_value.py).
"""

from __future__ import annotations

import asyncio
import logging
import math
import time
from datetime import date

from app.exceptions import DataSourceError
from app.services.box_score_service import _eastern_today, boxscore_for, scoreboard_for
from app.services.data_provider import get_data_provider
from app.services.surprise_service import fantasy_roster_for
from app.utils.constants import RANKING_CATEGORIES

logger = logging.getLogger(__name__)

# Category -> the per-line stat it reads. A per-game category is the stat
# itself on a single night.
_COUNTING = {
    "PTS": "PTS", "REB": "REB", "AST": "AST", "STL": "STL", "BLK": "BLK", "3PM": "3PM",
    "TO": "TO", "OREB": "OREB", "DREB": "DREB", "PF": "PF",
    "FGM": "FGM", "FGA": "FGA", "FTM": "FTM", "FTA": "FTA", "3PA": "3PA",
    "PPG": "PTS", "RPG": "REB", "APG": "AST", "BPG": "BLK", "SPG": "STL", "TOPG": "TO", "3PG": "3PM",
}
_RATIOS = {"FG%": ("FGM", "FGA"), "FT%": ("FTM", "FTA"), "3P%": ("3PM", "3PA")}

_cache: dict[str, tuple[float, dict]] = {}
_roster_cache: dict[str, tuple[float, dict]] = {}


def clear_box_score_value_cache() -> None:
    _cache.clear()
    _roster_cache.clear()


def _number(raw: str) -> float | None:
    try:
        return float(str(raw).lstrip("+"))
    except (TypeError, ValueError):
        return None


def _pair(raw: str) -> tuple[float, float] | None:
    made, _, attempted = str(raw).partition("-")
    m, a = _number(made), _number(attempted)
    return (m, a) if m is not None and a is not None else None


def _minutes(raw: str) -> float:
    return _number(str(raw).split(":")[0]) or 0.0


def stat_line(player: dict) -> dict[str, float] | None:
    """The numbers of one box-score line, or None when he did not get on the floor."""
    minutes = _minutes(player.get("min", ""))
    if minutes <= 0:
        return None
    line = {"MIN": minutes}
    for key, made, attempted in (("fg", "FGM", "FGA"), ("fg3", "3PM", "3PA"), ("ft", "FTM", "FTA")):
        line[made], line[attempted] = _pair(player.get(key, "")) or (0.0, 0.0)
    for key, stat in (("pts", "PTS"), ("reb", "REB"), ("ast", "AST"), ("stl", "STL"), ("blk", "BLK"),
                      ("tov", "TO"), ("oreb", "OREB"), ("dreb", "DREB"), ("pf", "PF")):
        line[stat] = _number(player.get(key, "")) or 0.0
    return line


def _zs(values: list[float]) -> list[float]:
    n = len(values)
    mean = sum(values) / n
    std = math.sqrt(sum((v - mean) ** 2 for v in values) / n)
    if std == 0:
        return [0.0] * n
    return [(v - mean) / std for v in values]


def slate_zscores(lines: list[dict[str, float]], categories: list[str], reverse: set[str]) -> tuple[list[float], list[str]]:
    """Each line's mean z over the categories this slate can score, and those
    categories. Categories a box score cannot carry are left out."""
    totals = [0.0] * len(lines)
    used: list[str] = []
    if not lines:
        return totals, used
    for category in categories:
        if category in _RATIOS:
            made, attempted = _RATIOS[category]
            volume = sum(line[attempted] for line in lines)
            rate = sum(line[made] for line in lines) / volume if volume else 0.0
            values = [line[made] - rate * line[attempted] for line in lines]
        elif category in _COUNTING:
            values = [line[_COUNTING[category]] for line in lines]
        else:
            continue
        sign = -1.0 if category in reverse else 1.0
        for index, z in enumerate(_zs(values)):
            totals[index] += sign * z
        used.append(category)
    count = len(used) or 1
    return [round(total / count, 2) for total in totals], used


async def _league_categories() -> tuple[list[str], set[str]]:
    provider = get_data_provider()
    try:
        return await provider.get_ranking_categories(), await provider.get_reverse_categories()
    except Exception as exc:
        logger.warning(f"Slate values: league categories unavailable, using defaults: {type(exc).__name__}: {exc}")
        return list(RANKING_CATEGORIES), set()


async def _fantasy_teams() -> tuple[dict[int, str], dict[int, str]]:
    provider = get_data_provider()
    try:
        abbrevs = await provider.get_team_abbrevs()
        names = {int(t["team_id"]): t["team_name"] for t in await provider.get_team_names()}
        return abbrevs, names
    except (DataSourceError, KeyError, TypeError, ValueError) as exc:
        logger.warning(f"Slate values: fantasy team names unavailable: {type(exc).__name__}: {exc}")
        return {}, {}


async def _roster_on(day: date) -> dict[int, dict]:
    """Who owned whom on that night. A past night's rosters never change; today's
    can until lock, so they are refetched every few minutes."""
    key = day.isoformat()
    hit = _roster_cache.get(key)
    if hit is not None and time.monotonic() < hit[0]:
        return hit[1]
    roster = await fantasy_roster_for(day)
    ttl = 6 * 60 * 60 if day < _eastern_today() and roster else 5 * 60
    _roster_cache[key] = (time.monotonic() + ttl, roster)
    return roster


def _ttl(games: list[dict], day: date, complete: bool) -> float:
    if complete and day < _eastern_today():
        return 6 * 60 * 60
    if any(game["status"] == "live" for game in games):
        return 15
    return 60


async def slate_values(day: date) -> dict:
    key = day.isoformat()
    hit = _cache.get(key)
    if hit is not None and time.monotonic() < hit[0]:
        return hit[1]

    board = await scoreboard_for(day)
    games = board["games"]
    started = [game for game in games if game["status"] != "scheduled"]
    boxes = await asyncio.gather(*(boxscore_for(game["game_id"]) for game in started), return_exceptions=True)

    rows: list[dict] = []
    lines: list[dict[str, float]] = []
    for game, box in zip(started, boxes):
        if isinstance(box, Exception):
            logger.warning(f"Slate values {day}: box {game['game_id']} unavailable: {type(box).__name__}: {box}")
            continue
        for side, other in (("away", "home"), ("home", "away")):
            team = box[side]
            for player in team["starters"] + team["bench"]:
                line = stat_line(player)
                if line is None:
                    continue
                lines.append(line)
                rows.append({
                    "player_id": player["player_id"],
                    "name": player["name"],
                    "position": player["position"],
                    "team_abbr": team["abbreviation"],
                    "team_logo": team["logo"],
                    "opponent_abbr": box[other]["abbreviation"],
                    "is_home": side == "home",
                    "game_id": box["game_id"],
                    "game_status": box["status"],
                    "min": player["min"],
                    "pts": player["pts"],
                    "reb": player["reb"],
                    "ast": player["ast"],
                    "stl": player["stl"],
                    "blk": player["blk"],
                    "tov": player["tov"],
                    "fg": player["fg"],
                    "fg3": player["fg3"],
                    "ft": player["ft"],
                })

    (categories, reverse), roster, (abbrevs, names) = await asyncio.gather(
        _league_categories(), _roster_on(day), _fantasy_teams(),
    )
    zs, used = slate_zscores(lines, categories, reverse)
    for row, z in zip(rows, zs):
        row["z"] = z
        owner = roster.get(int(row["player_id"])) if row["player_id"].isdigit() else None
        team_id = owner["team_id"] if owner else None
        row["fantasy_team"] = abbrevs.get(team_id, str(team_id)) if team_id is not None else None
        row["fantasy_team_name"] = (names.get(team_id) or row["fantasy_team"]) if team_id is not None else None
    rows.sort(key=lambda row: -row["z"])

    complete = bool(games) and all(game["status"] == "final" for game in games)
    payload = {
        "date": key,
        "complete": complete,
        "games_counted": sum(1 for box in boxes if not isinstance(box, Exception)),
        "categories": used,
        "players": rows,
    }
    _cache[key] = (time.monotonic() + _ttl(games, day, complete), payload)
    return payload

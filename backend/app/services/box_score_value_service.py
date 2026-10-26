"""One slate's player values: a Z per player line, and the fantasy team that
owned him that night.

The Z is the Player Rankings value (frontend/src/utils/playerRankings.ts) of a
single game: the page's reference pool is rebuilt here exactly as the page
builds it with its defaults (season stats, per game, no minimum games or
minutes: every player, and with 300+ of them the top 300 by a first pass), and
each game line is scored against that pool the way scoreAgainstPool scores a
player outside it. Per category, counting stats are plain z-scores; FG% and FT%
are the z of (pct - the pool's mean pct) * attempts; a reverse category
(turnovers) is negated; the value is the mean across categories. So a game's Z
reads on the Rankings scale: +1.5 is a game worth what a +1.5 player averages.

Every player who was not a DNP gets a Z. When season stats are unavailable the
night's own lines are the pool instead, and the response says so.
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
# Percentage category -> (makes, attempts), the pairs Player Rankings weights by attempts.
_PERCENTAGES = {"FG%": ("FGM", "FGA"), "FT%": ("FTM", "FTA")}
# Player Rankings' reference pool size.
REFERENCE_POOL_SIZE = 300

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


def stat_line(player: dict) -> dict[str, float]:
    """The numbers of one box-score line. Every listed player who was not a DNP
    has one; a stat ESPN leaves blank counts as 0."""
    line = {"MIN": _minutes(player.get("min", ""))}
    for key, made, attempted in (("fg", "FGM", "FGA"), ("fg3", "3PM", "3PA"), ("ft", "FTM", "FTA")):
        line[made], line[attempted] = _pair(player.get(key, "")) or (0.0, 0.0)
    for key, stat in (("pts", "PTS"), ("reb", "REB"), ("ast", "AST"), ("stl", "STL"), ("blk", "BLK"),
                      ("tov", "TO"), ("oreb", "OREB"), ("dreb", "DREB"), ("pf", "PF")):
        line[stat] = _number(player.get(key, "")) or 0.0
    return line


def _pct(line: dict[str, float], category: str) -> float:
    made, attempted = _PERCENTAGES[category]
    return line[made] / line[attempted] if line[attempted] else 0.0


def _mean_std(values: list[float]) -> tuple[float, float]:
    mean = sum(values) / len(values)
    return mean, math.sqrt(sum((v - mean) ** 2 for v in values) / len(values))


def _category_values(lines: list[dict[str, float]], category: str, pool: list[dict[str, float]]) -> list[float]:
    """What the z of a category is taken over: the stat itself, or for a
    percentage the attempt-weighted gap to the pool's mean pct."""
    if category in _PERCENTAGES:
        pool_mean = sum(_pct(line, category) for line in pool) / len(pool)
        attempts = _PERCENTAGES[category][1]
        return [(_pct(line, category) - pool_mean) * line[attempts] for line in lines]
    return [line[_COUNTING[category]] for line in lines]


def _score(lines: list[dict[str, float]], pool: list[dict[str, float]], categories: list[str],
           reverse: set[str]) -> list[float]:
    """Each line's mean z over the categories, against the pool's mean and spread."""
    totals = [0.0] * len(lines)
    for category in categories:
        mean, std = _mean_std(_category_values(pool, category, pool))
        sign = -1.0 if category in reverse else 1.0
        for index, value in enumerate(_category_values(lines, category, pool)):
            totals[index] += 0.0 if std == 0 else sign * (value - mean) / std
    return [total / len(categories) for total in totals]


def reference_pool(players: list[dict[str, float]], categories: list[str], reverse: set[str]) -> list[dict[str, float]]:
    """Player Rankings' reference pool: everyone, or with 300+ players the top
    300 by a first pass over everyone."""
    if len(players) < REFERENCE_POOL_SIZE:
        return players
    first = _score(players, players, categories, reverse)
    ranked = sorted(range(len(players)), key=lambda i: -first[i])
    return [players[i] for i in ranked[:REFERENCE_POOL_SIZE]]


def slate_zscores(lines: list[dict[str, float]], categories: list[str], reverse: set[str],
                  season: list[dict[str, float]] | None = None) -> tuple[list[float], list[str]]:
    """Each line's Z and the categories it was taken over, against the
    reference pool built from ``season`` (per-game lines), or from the night's
    own lines when there is none. Categories a box score cannot carry are left
    out."""
    used = [c for c in categories if c in _PERCENTAGES or c in _COUNTING]
    if not lines or not used:
        return [0.0] * len(lines), used
    pool = reference_pool(season or lines, used, reverse)
    return [round(z, 2) for z in _score(lines, pool, used, reverse)], used


# Category -> the field a players-list entry carries it in when its generic
# stats dict lacks it (playerRankings.ts FIXED_FIELD_KEY).
_FIXED_FIELDS = {"FG%": "fg_percentage", "FT%": "ft_percentage", "3PM": "three_pm", "AST": "ast",
                 "REB": "reb", "STL": "stl", "BLK": "blk", "PTS": "pts"}


def season_line(stats: dict, categories: list[str]) -> dict[str, float]:
    """A players-list entry's season stats as a per-game line in the keys a box
    line uses, the way the Rankings page reads them in per-game mode."""
    gp = max(float(stats.get("gp") or 0), 1.0)
    generic = stats.get("stats") or {}
    line = {key: 0.0 for key in set(_COUNTING.values()) | {"FGM", "FGA", "FTM", "FTA", "MIN"}}
    for category in categories:
        if category in _PERCENTAGES:
            made, attempted = _PERCENTAGES[category]
            attempts = float(stats.get(attempted.lower()) or 0) / gp
            pct = generic.get(category, stats.get(_FIXED_FIELDS[category]))
            line[attempted] = attempts
            line[made] = float(pct or 0) * attempts
        elif category in _COUNTING:
            raw = generic.get(category, stats.get(_FIXED_FIELDS.get(category, ""), 0))
            line[_COUNTING[category]] = float(raw or 0) / gp
    return line


async def _season_lines(categories: list[str]) -> list[dict[str, float]] | None:
    """Every player in the Rankings page's list, as per-game lines; None when
    the season stats cannot be had."""
    from app.services.player_service import PlayerService

    try:
        players = await PlayerService().get_all_players(page=1, limit=5000)
    except Exception as exc:
        logger.warning(f"Slate values: season stats unavailable, scoring against the slate: {type(exc).__name__}: {exc}")
        return None
    # The page ranks only players with data (partitionByDataAvailability).
    lines = [season_line(player.stats.model_dump(), categories)
             for player in players.players if player.has_data is not False]
    return lines or None


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
                lines.append(stat_line(player))
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
    season = await _season_lines(categories) if lines else None
    zs, used = slate_zscores(lines, categories, reverse, season)
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
        # What the Z is measured against: the Rankings page's season pool, or
        # the night's own lines when season stats were unavailable.
        "basis": "season" if season else "slate",
        "players": rows,
    }
    _cache[key] = (time.monotonic() + _ttl(games, day, complete), payload)
    return payload

"""NBA box scores from ESPN's public site API.

The scoreboard lists one day's games. Each game's summary is the full box:
player lines, starters, players who did not play, quarter scores, and team
totals. Unauthenticated, same host the nightly ingest already uses.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from app.utils.ssl_context import shared_ssl_context

logger = logging.getLogger(__name__)

EASTERN = ZoneInfo("America/New_York")
SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard"
SUMMARY_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary"
_HEX_COLOR = re.compile(r"^[0-9A-Fa-f]{6}$")

# ESPN player-box column name -> the key the page renders.
_PLAYER_STATS = (
    ("MIN", "min"),
    ("PTS", "pts"),
    ("FG", "fg"),
    ("3PT", "fg3"),
    ("FT", "ft"),
    ("REB", "reb"),
    ("AST", "ast"),
    ("TO", "tov"),
    ("STL", "stl"),
    ("BLK", "blk"),
    ("OREB", "oreb"),
    ("DREB", "dreb"),
    ("PF", "pf"),
    ("+/-", "plus_minus"),
)

_cache: dict[str, tuple[float, dict]] = {}
_client: httpx.AsyncClient | None = None


class BoxScoreUnavailable(Exception):
    """ESPN did not return a usable scoreboard or box score."""


class BoxScoreNotFound(Exception):
    """ESPN has no game for this id."""


def clear_box_score_cache() -> None:
    _cache.clear()


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            timeout=20.0,
            verify=shared_ssl_context(),
            headers={"Accept": "application/json"},
        )
    return _client


def _store(key: str, payload: dict, ttl: float) -> dict:
    _cache[key] = (time.monotonic() + ttl, payload)
    return payload


def _cached(key: str) -> dict | None:
    hit = _cache.get(key)
    if hit is None:
        return None
    expires, payload = hit
    if time.monotonic() > expires:
        _cache.pop(key, None)
        return None
    return payload


async def _get_json(url: str, params: dict[str, str]) -> dict:
    last: Exception | None = None
    for attempt in range(2):
        try:
            response = await _http().get(url, params=params)
            if response.status_code == 404:
                raise BoxScoreNotFound(url)
            response.raise_for_status()
            data = response.json()
            if not isinstance(data, dict):
                raise BoxScoreUnavailable(f"ESPN returned {type(data).__name__}")
            return data
        except BoxScoreNotFound:
            raise
        except (httpx.HTTPError, ValueError) as exc:
            last = exc
            logger.warning(f"ESPN GET {url} attempt {attempt + 1}/2 failed: {type(exc).__name__}: {exc}")
            if attempt == 0:
                await asyncio.sleep(0.4)
    raise BoxScoreUnavailable(f"GET {url} failed: {last}")


def _eastern_today() -> date:
    return datetime.now(EASTERN).date()


def _scoreboard_ttl(parsed: dict, day: date) -> float:
    games = parsed["games"]
    today = _eastern_today()
    if games and all(game["status"] == "final" for game in games) and day < today:
        return 6 * 60 * 60
    if day > today:
        return 30 * 60
    if any(game["status"] == "live" for game in games):
        return 15
    return 60


def _box_ttl(status: str) -> float:
    if status == "final":
        return 6 * 60 * 60
    if status == "live":
        return 15
    return 10 * 60


async def scoreboard_for(day: date) -> dict:
    key = f"sb:{day.isoformat()}"
    cached = _cached(key)
    if cached is not None:
        return cached
    payload = await _get_json(SCOREBOARD_URL, {"dates": day.strftime("%Y%m%d"), "limit": "100"})
    parsed = parse_scoreboard(payload, day)
    return _store(key, parsed, _scoreboard_ttl(parsed, day))


async def boxscore_for(game_id: str) -> dict:
    key = f"box:{game_id}"
    cached = _cached(key)
    if cached is not None:
        return cached
    payload = await _get_json(SUMMARY_URL, {"event": game_id})
    parsed = parse_boxscore(payload, game_id)
    return _store(key, parsed, _box_ttl(parsed["status"]))


# --- parsing -----------------------------------------------------------------


def parse_scoreboard(payload: dict, day: date) -> dict:
    games = []
    for event in payload.get("events") or []:
        game = _game_card(event)
        if game is not None:
            games.append(game)
    games.sort(key=lambda game: (game["start_time"], game["game_id"]))
    return {"date": day.isoformat(), "games": games}


def parse_boxscore(payload: dict, game_id: str) -> dict:
    try:
        competition = payload["header"]["competitions"][0]
    except (KeyError, IndexError, TypeError) as exc:
        raise BoxScoreUnavailable(f"Game {game_id} summary has no header") from exc

    status, detail = _status(competition.get("status") or {})
    away_comp, home_comp = _away_home(competition.get("competitors") or [])
    if away_comp is None or home_comp is None:
        raise BoxScoreUnavailable(f"Game {game_id} summary has no two teams")

    box = payload.get("boxscore") or {}
    player_blocks = {str((block.get("team") or {}).get("id")): block for block in box.get("players") or []}
    team_blocks = {str((block.get("team") or {}).get("id")): block for block in box.get("teams") or []}

    info = payload.get("gameInfo") or {}
    venue_obj = info.get("venue") or competition.get("venue") or {}
    city = str((venue_obj.get("address") or {}).get("city") or "")
    venue = str(venue_obj.get("fullName") or "")
    if venue and city:
        venue = f"{venue}, {city}"
    attendance = info.get("attendance")
    try:
        attendance = int(attendance) if attendance else None
    except (TypeError, ValueError):
        attendance = None

    away = _team_box(away_comp, status, player_blocks, team_blocks)
    home = _team_box(home_comp, status, player_blocks, team_blocks)
    period_count = max(len(away["linescores"]), len(home["linescores"]))
    return {
        "game_id": str(competition.get("id") or payload.get("header", {}).get("id") or game_id),
        "status": status,
        "status_detail": detail,
        "start_time": str(competition.get("date") or ""),
        "broadcast": _broadcast(competition),
        "venue": venue,
        "attendance": attendance,
        "periods": _period_labels(period_count),
        "away": away,
        "home": home,
    }


def _game_card(event: dict) -> dict | None:
    try:
        competition = event["competitions"][0]
    except (KeyError, IndexError, TypeError):
        return None
    away_comp, home_comp = _away_home(competition.get("competitors") or [])
    if away_comp is None or home_comp is None:
        return None
    status, detail = _status(event.get("status") or {})
    return {
        "game_id": str(event.get("id") or ""),
        "status": status,
        "status_detail": detail,
        "start_time": str(event.get("date") or ""),
        "broadcast": _broadcast(competition),
        "venue": str((competition.get("venue") or {}).get("fullName") or ""),
        "away": _side(away_comp, status),
        "home": _side(home_comp, status),
    }


def _away_home(competitors: list) -> tuple[dict | None, dict | None]:
    if len(competitors) < 2:
        return None, None
    away = next((c for c in competitors if c.get("homeAway") == "away"), None)
    home = next((c for c in competitors if c.get("homeAway") == "home"), None)
    if away is None or home is None:
        away, home = competitors[0], competitors[1]
    return away, home


def _status(status: dict) -> tuple[str, str]:
    kind = status.get("type") or {}
    state = kind.get("state")
    if state == "in":
        label = "live"
    elif state == "post" or kind.get("completed"):
        label = "final"
    else:
        label = "scheduled"
    detail = str(kind.get("shortDetail") or kind.get("detail") or "")
    return label, detail


def _side(competitor: dict, status: str) -> dict:
    identity = _identity(competitor)
    winner = bool(competitor.get("winner")) if status == "final" else False
    return {**identity, "score": _score(competitor, status), "winner": winner}


def _identity(competitor: dict, extra_team: dict | None = None) -> dict:
    team = dict(extra_team or {})
    for key, value in (competitor.get("team") or {}).items():
        if value not in (None, "", [], {}):
            team[key] = value
    color = str(team.get("color") or "")
    records = competitor.get("records") or []
    record = ""
    if records and isinstance(records[0], dict):
        record = str(records[0].get("summary") or "")
    return {
        "team_id": str(team.get("id") or ""),
        "name": team.get("displayName") or team.get("name") or team.get("abbreviation") or "Team",
        "short_name": team.get("shortDisplayName") or team.get("name") or team.get("abbreviation") or "",
        "abbreviation": team.get("abbreviation") or "",
        "logo": _logo(team),
        "color": color if _HEX_COLOR.fullmatch(color) else "",
        "record": record,
    }


def _logo(team: dict) -> str:
    if team.get("logo"):
        return str(team["logo"])
    for logo in team.get("logos") or []:
        rel = logo.get("rel") or []
        if "default" in rel and logo.get("href"):
            return str(logo["href"])
    logos = team.get("logos") or []
    if logos and logos[0].get("href"):
        return str(logos[0]["href"])
    return ""


def _score(competitor: dict, status: str) -> int | None:
    if status == "scheduled":
        return None
    raw = competitor.get("score")
    if raw in (None, ""):
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _broadcast(competition: dict) -> str:
    for key in ("broadcasts", "geoBroadcasts"):
        for item in competition.get(key) or []:
            names = item.get("names") or []
            if names:
                return str(names[0])
            short = (item.get("media") or {}).get("shortName")
            if short:
                return str(short)
    return ""


def _linescores(competitor: dict) -> list[str]:
    lines = []
    for entry in competitor.get("linescores") or []:
        value = entry.get("displayValue")
        lines.append("" if value in (None, "") else str(value))
    return lines


def _period_labels(count: int) -> list[str]:
    labels = []
    for index in range(count):
        if index < 4:
            labels.append(str(index + 1))
        elif index == 4:
            labels.append("OT")
        else:
            labels.append(f"{index - 3}OT")
    return labels


def _team_box(competitor: dict, status: str, player_blocks: dict, team_blocks: dict) -> dict:
    identity = _identity(competitor)
    block = player_blocks.get(identity["team_id"]) or {}
    # The summary header team omits the logo and the short name; the box block has both.
    identity = _identity(competitor, block.get("team") or {})
    starters, bench, dnp = _players(block)
    totals = _totals(team_blocks.get(identity["team_id"]) or {}, starters + bench, _score(competitor, status))
    return {
        **identity,
        "score": _score(competitor, status),
        "winner": bool(competitor.get("winner")) if status == "final" else False,
        "linescores": _linescores(competitor),
        "starters": starters,
        "bench": bench,
        "did_not_play": dnp,
        "totals": totals,
        "shooting": _shooting(team_blocks.get(identity["team_id"]) or {}),
    }


def _players(block: dict) -> tuple[list[dict], list[dict], list[dict]]:
    statistics = (block.get("statistics") or [{}])[0]
    names = statistics.get("names") or []
    index = {name: i for i, name in enumerate(names)}
    starters, bench, dnp = [], [], []
    for athlete in statistics.get("athletes") or []:
        person = athlete.get("athlete") or {}
        name = person.get("displayName") or person.get("shortName") or ""
        if not name:
            continue
        if athlete.get("didNotPlay"):
            dnp.append({
                "player_id": str(person.get("id") or ""),
                "name": name,
                "position": (person.get("position") or {}).get("abbreviation") or "",
                "reason": str(athlete.get("reason") or ""),
            })
            continue
        line = _player_line(athlete, index)
        if athlete.get("starter"):
            starters.append(line)
        else:
            bench.append(line)
    return starters, bench, dnp


def _player_line(athlete: dict, index: dict[str, int]) -> dict:
    person = athlete.get("athlete") or {}
    values = athlete.get("stats") or []
    line = {
        "player_id": str(person.get("id") or ""),
        "name": person.get("displayName") or person.get("shortName") or "Unknown",
        "position": (person.get("position") or {}).get("abbreviation") or "",
        "ejected": bool(athlete.get("ejected")),
    }
    for espn_name, key in _PLAYER_STATS:
        slot = index.get(espn_name)
        raw = values[slot] if slot is not None and slot < len(values) else ""
        line[key] = "" if raw in (None, "--") else str(raw)
    return line


def _stat_display(block: dict) -> dict[str, str]:
    out = {}
    for item in block.get("statistics") or []:
        name = item.get("name")
        if name:
            out[name] = str(item.get("displayValue") or "")
    return out


def _first(stats: dict[str, str], *names: str) -> str:
    for name in names:
        if stats.get(name):
            return stats[name]
    return ""


def _totals(block: dict, players: list[dict], score: int | None) -> dict[str, str]:
    stats = _stat_display(block)
    points = str(score) if score is not None else _sum_numbers(players, "pts")
    # A game that has not tipped off carries season averages in this block
    # (fieldGoalPct, avgPoints), not a box score. Leave those off the page.
    if "fieldGoalsMade-fieldGoalsAttempted" not in stats and not players:
        blank = {key: "" for _, key in _PLAYER_STATS}
        blank["pts"] = points
        return blank
    return {
        "min": _sum_minutes(players),
        "pts": points,
        "fg": _first(stats, "fieldGoalsMade-fieldGoalsAttempted"),
        "fg3": _first(stats, "threePointFieldGoalsMade-threePointFieldGoalsAttempted"),
        "ft": _first(stats, "freeThrowsMade-freeThrowsAttempted"),
        "reb": _first(stats, "totalRebounds") or _sum_numbers(players, "reb"),
        "ast": _first(stats, "assists") or _sum_numbers(players, "ast"),
        "tov": _first(stats, "totalTurnovers", "turnovers") or _sum_numbers(players, "tov"),
        "stl": _first(stats, "steals") or _sum_numbers(players, "stl"),
        "blk": _first(stats, "blocks") or _sum_numbers(players, "blk"),
        "oreb": _first(stats, "offensiveRebounds") or _sum_numbers(players, "oreb"),
        "dreb": _first(stats, "defensiveRebounds") or _sum_numbers(players, "dreb"),
        "pf": _first(stats, "fouls") or _sum_numbers(players, "pf"),
        "plus_minus": "",
    }


def _shooting(block: dict) -> dict[str, str]:
    stats = _stat_display(block)
    if "fieldGoalsMade-fieldGoalsAttempted" not in stats:
        return {
            "fg_pct": "",
            "fg3_pct": "",
            "ft_pct": "",
            "points_in_paint": "",
            "fast_break_points": "",
            "turnover_points": "",
            "largest_lead": "",
        }
    return {
        "fg_pct": _first(stats, "fieldGoalPct"),
        "fg3_pct": _first(stats, "threePointFieldGoalPct"),
        "ft_pct": _first(stats, "freeThrowPct"),
        "points_in_paint": _first(stats, "pointsInPaint"),
        "fast_break_points": _first(stats, "fastBreakPoints"),
        "turnover_points": _first(stats, "turnoverPoints"),
        "largest_lead": _first(stats, "largestLead"),
    }


def _sum_numbers(players: list[dict], key: str) -> str:
    total = 0
    seen = False
    for player in players:
        raw = str(player.get(key) or "").lstrip("+")
        try:
            total += int(float(raw))
            seen = True
        except ValueError:
            continue
    return str(total) if seen else ""


def _sum_minutes(players: list[dict]) -> str:
    total = 0
    seen = False
    for player in players:
        raw = str(player.get("min") or "")
        if not raw:
            continue
        head = raw.split(":")[0]
        try:
            total += int(float(head))
            seen = True
        except ValueError:
            return ""
    return str(total) if seen else ""

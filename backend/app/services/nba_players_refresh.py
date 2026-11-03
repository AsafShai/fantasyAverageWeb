"""Refresh the NBA players catalog in Postgres from ESPN rosters."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import httpx

from app.services import nba_player_catalog
from app.utils.ssl_context import shared_ssl_context

logger = logging.getLogger(__name__)

MIN_PLAYERS = 100
SEASON_LABEL = "2025-26"
TEAMS_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams?limit=100"
ROSTER_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{tid}/roster"

EAST = {
    "ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DET", "IND", "MIA", "MIL",
    "NYK", "ORL", "PHI", "TOR", "WAS",
}

ABBR_ALIASES = {
    "NY": "NYK",
    "GS": "GSW",
    "UTAH": "UTA",
    "NO": "NOP",
    "SA": "SAS",
    "WSH": "WAS",
}

TEAM_DIVISION = {
    "ATL": "Southeast", "BOS": "Atlantic", "BKN": "Atlantic", "CHA": "Southeast",
    "CHI": "Central", "CLE": "Central", "DAL": "Southwest", "DEN": "Northwest",
    "DET": "Central", "GSW": "Pacific", "HOU": "Southwest", "IND": "Central",
    "LAC": "Pacific", "LAL": "Pacific", "MEM": "Southwest", "MIA": "Southeast",
    "MIL": "Central", "MIN": "Northwest", "NOP": "Southwest", "NYK": "Atlantic",
    "OKC": "Northwest", "ORL": "Southeast", "PHI": "Atlantic", "PHX": "Pacific",
    "POR": "Northwest", "SAC": "Pacific", "SAS": "Southwest", "TOR": "Atlantic",
    "UTA": "Northwest", "WAS": "Southeast",
}


def normalize_team_abbr(abbr: str) -> str:
    if not abbr or not isinstance(abbr, str):
        return abbr
    return ABBR_ALIASES.get(abbr.strip().upper(), abbr.strip().upper())


def conference_for_abbr(abbr: str) -> str:
    return "East" if normalize_team_abbr(abbr) in EAST else "West"


def division_for_abbr(abbr: str) -> str:
    return TEAM_DIVISION.get(normalize_team_abbr(abbr), "Unknown")


# ESPN sometimes sends the specific role (Point Guard) instead of the bucket (Guard).
_POSITION_BUCKETS = {
    "point guard": "Guard",
    "pg": "Guard",
    "shooting guard": "Guard",
    "sg": "Guard",
    "guard": "Guard",
    "g": "Guard",
    "small forward": "Forward",
    "sf": "Forward",
    "power forward": "Forward",
    "pf": "Forward",
    "forward": "Forward",
    "f": "Forward",
    "center": "Center",
    "c": "Center",
}


def normalize_position(pos: str) -> str:
    raw = (pos or "").strip()
    if not raw:
        return "Unknown"
    return _POSITION_BUCKETS.get(raw.lower(), raw)


def _player_from_athlete(a: dict, team_name: str, abbr: str) -> dict[str, Any] | None:
    full_name = a.get("fullName") or a.get("displayName")
    if not full_name or not isinstance(full_name, str):
        return None
    pos = (
        (a.get("position") or {}).get("displayName")
        or (a.get("position") or {}).get("abbreviation")
        or (a.get("position") or {}).get("type")
        or "Unknown"
    )
    hs = a.get("headshot") or {}
    href = hs.get("href") if isinstance(hs.get("href"), str) else None
    dh = a.get("displayHeight")
    height = dh if isinstance(dh, str) and dh else None
    bp = a.get("birthPlace") or {}
    nat = bp.get("country") if isinstance(bp.get("country"), str) else None
    age_val = a.get("age")
    age = age_val if isinstance(age_val, (int, float)) and age_val == age_val else None
    if age is not None:
        age = int(age)
    j = a.get("jersey")
    jersey_number = str(j).strip() if j is not None and str(j).strip() != "" else None
    return {
        "id": f"espn-{a.get('id')}",
        "displayName": full_name.strip(),
        "team": team_name,
        "teamAbbr": abbr,
        "conference": conference_for_abbr(abbr),
        "division": division_for_abbr(abbr),
        "position": normalize_position(str(pos)),
        "photoUrl": href if href else None,
        "height": height,
        "nationality": nat,
        "age": age,
        "jerseyNumber": jersey_number,
    }


def _dedupe_and_preserve(players: list[dict], previous_by_id: dict[str, dict]) -> list[dict]:
    by_name: dict[str, dict] = {}
    for p in players:
        key = p["displayName"].lower()
        if key not in by_name:
            by_name[key] = p
    unique = list(by_name.values())
    preserved = 0
    for p in unique:
        prev = previous_by_id.get(p.get("id"))
        if not prev:
            continue
        for key, value in list(p.items()):
            if value is None and prev.get(key) is not None:
                p[key] = prev[key]
                preserved += 1
    if previous_by_id:
        logger.info("Preserved %d prior non-null field(s) from existing catalog", preserved)
    return unique


async def refresh_nba_players_catalog() -> int:
    """Fetch current ESPN rosters and persist the catalog to Postgres.

    Refuses to replace the catalog if ESPN returns fewer than ``MIN_PLAYERS``.
    """
    async with httpx.AsyncClient(timeout=60.0, headers={"Accept": "application/json"}, verify=shared_ssl_context()) as client:
        teams_data = (await client.get(TEAMS_URL)).raise_for_status().json()
        teams = teams_data.get("sports", [{}])[0].get("leagues", [{}])[0].get("teams", [])
        players: list[dict] = []
        for entry in teams:
            team = entry.get("team") or {}
            tid = team.get("id")
            abbr_raw = team.get("abbreviation")
            city = team.get("location") or ""
            nickname = team.get("name") or ""
            team_name = " ".join(p for p in (city, nickname) if p).strip() or team.get("displayName")
            if not tid or not abbr_raw:
                continue
            abbr = normalize_team_abbr(abbr_raw)
            roster = (await client.get(ROSTER_URL.format(tid=tid))).raise_for_status().json()
            for athlete in roster.get("athletes") or []:
                row = _player_from_athlete(athlete, team_name, abbr)
                if row:
                    players.append(row)

    previous_by_id = await nba_player_catalog.load_previous_players_by_id()
    unique = _dedupe_and_preserve(players, previous_by_id)
    if len(unique) < MIN_PLAYERS:
        raise RuntimeError(
            f"ESPN roster refresh returned {len(unique)} players; "
            f"need at least {MIN_PLAYERS} to replace the catalog"
        )
    count = await nba_player_catalog.replace_all(
        unique,
        season_label=SEASON_LABEL,
        source="ESPN roster API (nba players refresh)",
    )
    return count


def refresh_nba_players_catalog_sync() -> int:
    import asyncio

    return asyncio.run(refresh_nba_players_catalog())


# Backward-compatible aliases for scripts and tests.
async def refresh_nba_players_json(out_path: Path | None = None) -> int:
    if out_path is not None:
        raise ValueError("out_path is no longer supported; catalog is stored in Postgres")
    return await refresh_nba_players_catalog()


def refresh_nba_players_json_sync(out_path: Path | None = None) -> int:
    if out_path is not None:
        raise ValueError("out_path is no longer supported; catalog is stored in Postgres")
    return refresh_nba_players_catalog_sync()

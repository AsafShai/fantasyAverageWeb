"""Refresh the static NBA players JSON from ESPN rosters."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from app.services import nba_player_catalog

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


def load_previous_players_by_id(path: Path) -> dict[str, dict]:
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    players = data.get("players") if isinstance(data, dict) else None
    if not isinstance(players, list):
        return {}
    by_id: dict[str, dict] = {}
    for p in players:
        if isinstance(p, dict) and isinstance(p.get("id"), str):
            by_id[p["id"]] = p
    return by_id


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
        "position": str(pos),
        "photoUrl": href if href else None,
        "height": height,
        "nationality": nat,
        "age": age,
        "jerseyNumber": jersey_number,
    }


def _dedupe_and_preserve(players: list[dict], out_path: Path) -> list[dict]:
    by_name: dict[str, dict] = {}
    for p in players:
        key = p["displayName"].lower()
        if key not in by_name:
            by_name[key] = p
    unique = list(by_name.values())
    previous_by_id = load_previous_players_by_id(out_path)
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
        logger.info("Preserved %d prior non-null field(s) from %s", preserved, out_path.name)
    return unique


def write_players_payload(players: list[dict], out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "seasonLabel": SEASON_LABEL,
        "source": "ESPN roster API (run create_nba_players_json.py)",
        "updatedAt": datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z"),
        "players": players,
    }
    out_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


async def refresh_nba_players_json(out_path: Path | None = None) -> int:
    """Fetch current ESPN rosters, write the catalog JSON, and reload memory.

    Refuses to overwrite the file if ESPN returns fewer than ``MIN_PLAYERS``.
    """
    path = out_path or nba_player_catalog.JSON_PATH
    async with httpx.AsyncClient(timeout=60.0, headers={"Accept": "application/json"}) as client:
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

    unique = _dedupe_and_preserve(players, path)
    if len(unique) < MIN_PLAYERS:
        raise RuntimeError(
            f"ESPN roster refresh returned {len(unique)} players; "
            f"need at least {MIN_PLAYERS} to overwrite {path.name}"
        )
    write_players_payload(unique, path)
    nba_player_catalog.reset_catalog_cache()
    logger.info("Wrote %d NBA players to %s", len(unique), path)
    return len(unique)


def refresh_nba_players_json_sync(out_path: Path | None = None) -> int:
    import asyncio

    return asyncio.run(refresh_nba_players_json(out_path))

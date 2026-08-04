#!/usr/bin/env python3
"""
Fetches all current NBA roster players from ESPN and writes a JSON bundle.

Run from backend/:
  python3 scripts/create_nba_players_json.py
  # or from repo root: python3 backend/scripts/create_nba_players_json.py

Writes: backend/data/nba-players-2025-26.json

Requires: Python 3.9+, network
"""
from __future__ import annotations

import json
import ssl
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# backend/scripts/ → backend/
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "nba-players-2025-26.json"

EAST = {
    "ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DET", "IND", "MIA", "MIL",
    "NYK", "ORL", "PHI", "TOR", "WAS",
}

# ESPN team abbreviations sometimes differ from the NBA keys in EAST / TEAM_DIVISION.
ABBR_ALIASES = {
    "NY": "NYK",
    "GS": "GSW",
    "UTAH": "UTA",
    "NO": "NOP",
    "SA": "SAS",
    "WSH": "WAS",
}


def normalize_team_abbr(abbr: str) -> str:
    if not abbr or not isinstance(abbr, str):
        return abbr
    u = abbr.strip().upper()
    return ABBR_ALIASES.get(u, u)


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


def fetch_json(url: str) -> dict:
    ctx = ssl.create_default_context()
    req = urllib.request.Request(
        url,
        headers={"Accept": "application/json"},
    )
    with urllib.request.urlopen(req, context=ctx, timeout=60) as r:
        return json.loads(r.read().decode())


def conference_for_abbr(abbr: str) -> str:
    a = normalize_team_abbr(abbr)
    return "East" if a in EAST else "West"


def division_for_abbr(abbr: str) -> str:
    a = normalize_team_abbr(abbr)
    return TEAM_DIVISION.get(a, "Unknown")


def load_previous_players_by_id(path: Path) -> dict[str, dict]:
    """Load existing players keyed by id, for filling nulls on re-fetch."""
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


def main() -> None:
    teams_data = fetch_json(
        "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams?limit=100"
    )
    teams = teams_data.get("sports", [{}])[0].get("leagues", [{}])[0].get("teams", [])
    players: list[dict] = []

    for entry in teams:
        team = entry.get("team") or {}
        tid = team.get("id")
        abbr_raw = team.get("abbreviation")
        city = team.get("location") or ""
        nickname = team.get("name") or ""
        parts = [city, nickname]
        team_name = " ".join(p for p in parts if p).strip() or team.get("displayName")
        if not tid or not abbr_raw:
            continue

        abbr = normalize_team_abbr(abbr_raw)
        roster = fetch_json(
            f"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{tid}/roster"
        )
        athletes = roster.get("athletes") or []
        conf = conference_for_abbr(abbr)
        div = division_for_abbr(abbr)

        for a in athletes:
            full_name = a.get("fullName") or a.get("displayName")
            if not full_name or not isinstance(full_name, str):
                continue
            pos = (
                (a.get("position") or {}).get("displayName")
                or (a.get("position") or {}).get("abbreviation")
                or (a.get("position") or {}).get("type")
                or "Unknown"
            )
            hs = a.get("headshot") or {}
            href = hs.get("href") if isinstance(hs.get("href"), str) else None
            photo = href if href else None

            dh = a.get("displayHeight")
            height = dh if isinstance(dh, str) and dh else None

            bp = a.get("birthPlace") or {}
            nat = bp.get("country") if isinstance(bp.get("country"), str) else None

            age_val = a.get("age")
            age = age_val if isinstance(age_val, (int, float)) and age_val == age_val else None
            if age is not None:
                age = int(age)

            j = a.get("jersey")
            jersey_number = None
            if j is not None and str(j).strip() != "":
                jersey_number = str(j).strip()

            players.append(
                {
                    "id": f"espn-{a.get('id')}",
                    "displayName": full_name.strip(),
                    "team": team_name,
                    "teamAbbr": abbr,
                    "conference": conf,
                    "division": div,
                    "position": str(pos),
                    "photoUrl": photo,
                    "height": height,
                    "nationality": nat,
                    "age": age,
                    "jerseyNumber": jersey_number,
                }
            )

    by_name: dict[str, dict] = {}
    for p in players:
        key = p["displayName"].lower()
        if key not in by_name:
            by_name[key] = p
    unique = list(by_name.values())

    # Preserve prior non-null fields when ESPN returns null for the same player.
    previous_by_id = load_previous_players_by_id(OUT)
    preserved = 0
    for p in unique:
        prev = previous_by_id.get(p.get("id"))
        if not prev:
            continue
        for key, value in list(p.items()):
            if value is None and prev.get(key) is not None:
                p[key] = prev[key]
                preserved += 1

    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "seasonLabel": "2025-26",
        "source": "ESPN roster API (run create_nba_players_json.py)",
        "updatedAt": datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z"),
        "players": unique,
    }
    OUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(unique)} players to {OUT}")
    if previous_by_id:
        print(f"Preserved {preserved} prior non-null field(s) from {OUT.name}")


if __name__ == "__main__":
    main()

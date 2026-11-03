#!/usr/bin/env python3
"""One-time helper: load backend/data/nba-players-2025-26.json into Postgres if it exists."""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.nba_players_refresh import refresh_nba_players_catalog_sync

JSON_PATH = Path(__file__).resolve().parents[1] / "data" / "nba-players-2025-26.json"


async def _import() -> int:
    from app.services import nba_player_catalog

    if not JSON_PATH.is_file():
        raise SystemExit(f"No file at {JSON_PATH}; run create_nba_players_json.py instead")
    payload = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    players = payload.get("players") or []
    if not isinstance(players, list):
        raise SystemExit("Invalid JSON payload")
    return await nba_player_catalog.replace_all(
        players,
        season_label=str(payload.get("seasonLabel") or "2025-26"),
        source=str(payload.get("source") or "imported from nba-players JSON"),
    )


if __name__ == "__main__":
    import asyncio

    count = asyncio.run(_import())
    print(f"Imported {count} players into the database")

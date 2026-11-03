#!/usr/bin/env python3
"""
Fetch all current NBA roster players from ESPN and persist the catalog in Postgres.

Run from backend/ (requires DATABASE_URL and migrations applied):
  uv run python scripts/create_nba_players_json.py

The API also runs this once a day at 08:00 Israel time when
NBA_PLAYERS_REFRESH_ENABLED=true.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.nba_players_refresh import refresh_nba_players_catalog_sync

if __name__ == "__main__":
    count = refresh_nba_players_catalog_sync()
    print(f"Persisted {count} players to the database")

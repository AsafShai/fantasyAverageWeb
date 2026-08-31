#!/usr/bin/env python3
"""
Fetches all current NBA roster players from ESPN and writes a JSON bundle.

Run from backend/:
  python3 scripts/create_nba_players_json.py
  # or from repo root: python3 backend/scripts/create_nba_players_json.py

Writes: backend/data/nba-players-2025-26.json

The API also runs this once a day at 08:00 Israel time when
NBA_PLAYERS_REFRESH_ENABLED=true.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.nba_players_refresh import refresh_nba_players_json_sync

if __name__ == "__main__":
    count = refresh_nba_players_json_sync()
    print(f"Wrote {count} players")

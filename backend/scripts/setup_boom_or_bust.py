"""Set up Boom or Bust on a database in one go: apply its migrations and score
every processed night this season that has no surprise rows yet.

Safe to run again: both migrations are IF NOT EXISTS, and the backfill never
rescores a night that already has rows.

Meant to run from a developer's machine against the server's database: the
backfill needs this checkout's code and ESPN, not the deployed app, so the
page fills before (or without) a deploy.

Usage (from backend/):
    uv run python scripts/setup_boom_or_bust.py --database-url postgresql://...   # the server
    uv run python scripts/setup_boom_or_bust.py                                   # DATABASE_URL / .env
    uv run python scripts/setup_boom_or_bust.py --migrations-only
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

MIGRATIONS = [
    BACKEND / "migrations" / "create_model_surprise_results.sql",
    BACKEND / "migrations" / "add_surprise_fantasy_columns.sql",
]


async def apply_migrations(db) -> None:
    pool = await db._get_pool()
    if pool is None:
        raise SystemExit("No database: set DATABASE_URL")
    async with pool.acquire() as conn:
        for path in MIGRATIONS:
            await conn.execute(path.read_text())
            print(f"applied {path.name}")
        cols = await conn.fetch(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'model_surprise_results' ORDER BY ordinal_position"
        )
    names = [c["column_name"] for c in cols]
    missing = {"fantasy_team_id", "fantasy_team", "lineup_slot"} - set(names)
    if missing:
        raise SystemExit(f"model_surprise_results is missing {sorted(missing)}")
    print(f"model_surprise_results: {len(names)} columns, fantasy columns present")


async def main(migrations_only: bool) -> None:
    # Imported here so --database-url (exported below) is seen by app settings.
    from app.services.db_service import DBService
    from app.services.surprise_service import SurpriseService

    db = DBService()
    try:
        await apply_migrations(db)
        if migrations_only:
            return
        done = await SurpriseService(db=db).backfill_missing()
        if not done:
            print("backfill: nothing to score, every processed night has rows")
        for night, status in done.items():
            print(f"backfill {night}: {status}")
        latest = await db.get_latest_surprise_date()
        print(f"latest scored night: {latest}")
    finally:
        await db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Apply Boom or Bust migrations and backfill unscored nights")
    parser.add_argument("--database-url", help="Postgres URL; falls back to DATABASE_URL / .env")
    parser.add_argument("--migrations-only", action="store_true", help="apply the migrations, skip the backfill")
    args = parser.parse_args()
    if args.database_url:
        os.environ["DATABASE_URL"] = args.database_url
    url = os.environ.get("DATABASE_URL")
    if not url:
        # .env is read by app settings; say which host that resolves to as well.
        from app.config import settings
        url = settings.database_url
    if not url:
        parser.error("no database given: pass --database-url or set DATABASE_URL")
    target = urlparse(url)
    print(f"database: {target.hostname}:{target.port or 5432}/{target.path.lstrip('/')}")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    asyncio.run(main(args.migrations_only))

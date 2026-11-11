"""Score again every stored Boom or Bust night, after the score's math, a
weight or the calibration changed (serving/surprise.py, surprise_calibration.json):
without it the nights already stored keep the old score and the page mixes two.

Replaces the rows of every night that has rows, oldest first, from --since
(default: the season's first day). Nothing else is touched: the nights' box
scores and model estimates are read, not written. Safe to run again.

Meant to run from a developer's machine against the server's database, on a
checkout that has the new score: it needs this checkout's code and ESPN (the
league's rosters of each night), not the deployed app. Deploy the same code
too, or the next nightly scores its night by the old score; the running app
also keeps what it read in memory for up to 6 hours, so the page shows the
new scores after that deploy (or a restart).

Usage (from backend/):
    uv run python scripts/rescore_boom_or_bust.py --database-url postgresql://...   # the server
    uv run python scripts/rescore_boom_or_bust.py                                   # DATABASE_URL / .env
    uv run python scripts/rescore_boom_or_bust.py --since 2026-10-20
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from datetime import date
from pathlib import Path
from urllib.parse import urlparse

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))


async def verdicts(db, since: date | None) -> str:
    """How many stored rows are past the server's bars, for a before / after line."""
    pool = await db._get_pool()
    if pool is None:
        raise SystemExit("No database: set DATABASE_URL")
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT COUNT(DISTINCT game_date) AS nights, COUNT(*) AS rows, "
            "COUNT(*) FILTER (WHERE verdict = 'good') AS booms, COUNT(*) FILTER (WHERE verdict = 'bad') AS busts "
            "FROM model_surprise_results WHERE ($1::date IS NULL OR game_date >= $1)",
            since,
        )
    return f"{row['nights']} nights, {row['rows']} rows, {row['booms']} booms, {row['busts']} busts"


async def main(since: date | None) -> None:
    # Imported here so --database-url (exported below) is seen by app settings.
    from app.services.db_service import DBService
    from app.services.surprise_service import SurpriseService

    db = DBService()
    try:
        print(f"before: {await verdicts(db, since)}")
        done = await SurpriseService(db=db).rescore(since)
        if not done:
            print("rescore: no stored night to score again")
        for night, status in done.items():
            print(f"rescore {night}: {status}")
        print(f"after:  {await verdicts(db, since)}")
        failed = [str(night) for night, status in done.items() if status == "failed"]
        if failed:
            raise SystemExit(f"failed nights (run again, they keep their old rows): {', '.join(failed)}")
    finally:
        await db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Score again every stored Boom or Bust night")
    parser.add_argument("--database-url", help="Postgres URL; falls back to DATABASE_URL / .env")
    parser.add_argument("--since", help="YYYY-MM-DD: the first night to score again (default: the season's first day)")
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
    asyncio.run(main(date.fromisoformat(args.since) if args.since else None))

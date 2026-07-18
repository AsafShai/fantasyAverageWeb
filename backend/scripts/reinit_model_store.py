"""Full re-init of the model feature store — for big migrations (e.g. an ID-space
change like the ESPN migration), where old rows and new rows cannot coexist.

Given a database, it alone:
  1. shows the current row counts of the 6 model-side tables
  2. optionally backs up prediction history (model_eval_results, model_nightly_runs)
     to CSV before anything is deleted
  3. wipes the old history (the fantasy-side tables are never touched)
  4. re-seeds the store from ESPN for all research seasons (uses the month-parquet
     cache under model_stats_inference/research/data/espn_cache when present —
     seconds instead of hours) and materializes fresh vectors
  5. verifies the new counts and reports timing

Usage (from backend/):
    python scripts/reinit_model_store.py --database-url postgresql://... [--yes]
    DATABASE_URL=... python scripts/reinit_model_store.py --yes
    python scripts/reinit_model_store.py --backup-dir ./pre_migration_backup --yes
    python scripts/reinit_model_store.py --until-date 2026-01-15 --yes   # replay testing

Destructive: requires typing REINIT at the prompt unless --yes is passed.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import logging
import os
import sys
import time
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Model-side tables only. Fantasy tables (team_daily_snapshot, team_rankings_*,
# estimator_*, player_injury_status) are a different ID space and must survive.
FS_TABLES = [
    "fs_player_games",
    "fs_team_games",
    "fs_player_vectors",
    "fs_team_allowed_vectors",
    "fs_team_own_vectors",
]
HISTORY_TABLES = ["model_eval_results", "model_nightly_runs"]
ALL_TABLES = FS_TABLES + HISTORY_TABLES

logger = logging.getLogger("reinit_model_store")


async def _counts(pool, tables: list[str]) -> dict[str, int]:
    out: dict[str, int] = {}
    async with pool.acquire() as conn:
        for t in tables:
            try:
                out[t] = await conn.fetchval(f"SELECT COUNT(*) FROM {t}")
            except Exception:
                out[t] = -1  # table missing
    return out


async def _backup(pool, backup_dir: Path) -> None:
    backup_dir.mkdir(parents=True, exist_ok=True)
    async with pool.acquire() as conn:
        for t in HISTORY_TABLES:
            try:
                rows = await conn.fetch(f"SELECT * FROM {t}")
            except Exception:
                continue
            path = backup_dir / f"{t}.csv"
            with path.open("w", newline="") as f:
                if rows:
                    writer = csv.writer(f)
                    writer.writerow(rows[0].keys())
                    writer.writerows([tuple(r) for r in rows])
            print(f"  backed up {len(rows):>7,} rows -> {path}")


def _print_counts(title: str, counts: dict[str, int]) -> None:
    print(f"\n{title}")
    for t, n in counts.items():
        print(f"  {t:<28} {'(missing)' if n < 0 else f'{n:,}'}")


async def _main(args: argparse.Namespace) -> int:
    # Imported here so --database-url (exported above) is seen by app settings.
    from app.services.db_service import DBService
    from app.services.model_nightly_service import ModelNightlyService

    db = DBService()
    pool = await db._get_pool()
    if pool is None:
        print("ERROR: cannot connect — check --database-url / DATABASE_URL", file=sys.stderr)
        return 1

    before = await _counts(pool, ALL_TABLES)
    _print_counts("Current state:", before)

    if args.backup_dir:
        print("\nBacking up prediction history:")
        await _backup(pool, Path(args.backup_dir))

    if not args.yes:
        answer = input(
            "\nThis WIPES the tables above and re-seeds from ESPN. Type REINIT to continue: "
        )
        if answer.strip() != "REINIT":
            print("Aborted — nothing was changed.")
            return 1

    t0 = time.perf_counter()

    # History tables first (bootstrap's forced truncate covers only the fs tables).
    async with pool.acquire() as conn:
        existing = [t for t in HISTORY_TABLES if before.get(t, -1) >= 0]
        if existing:
            await conn.execute(f"TRUNCATE {', '.join(existing)}")
            print(f"\nWiped {', '.join(existing)}")

    until = date.fromisoformat(args.until_date) if args.until_date else None
    status = await ModelNightlyService().bootstrap(force=True, until_date=until)
    if status != "bootstrapped":
        print(f"ERROR: bootstrap returned '{status}'", file=sys.stderr)
        return 1

    after = await _counts(pool, ALL_TABLES)
    _print_counts("New state:", after)
    print(f"\nDone in {time.perf_counter() - t0:.1f}s — store re-initialized; "
          "restart the app so it loads the fresh vectors.")
    await db.close()
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--database-url", help="Postgres URL; falls back to DATABASE_URL env")
    parser.add_argument("--backup-dir", help="dump model_eval_results/model_nightly_runs to CSV here before wiping")
    parser.add_argument("--until-date", help="seed only rows before this date (YYYY-MM-DD, replay testing)")
    parser.add_argument("--yes", action="store_true", help="skip the confirmation prompt")
    args = parser.parse_args()

    if args.database_url:
        os.environ["DATABASE_URL"] = args.database_url
    if not os.environ.get("DATABASE_URL"):
        parser.error("no database given — pass --database-url or set DATABASE_URL")

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    raise SystemExit(asyncio.run(_main(args)))

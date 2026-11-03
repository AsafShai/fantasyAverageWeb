"""Recompute the season estimator now, even when today's results already exist.

The scheduled run skips whenever the stored results already cover the latest
ESPN snapshot, so after a change to the estimator's model the old numbers stay
until the next morning after games. This forces the run: it syncs the latest
ESPN data, recomputes, and overwrites today's stored results (they are keyed by
snapshot date). Nothing else is touched.

Usage (from backend/):
    python scripts/rerun_estimator.py --database-url postgresql://...
    DATABASE_URL=... python scripts/rerun_estimator.py
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


async def _main() -> int:
    # Imported here so --database-url (exported below) is seen by app settings.
    from app.services.data_provider import DataProvider
    from app.services.estimator_service import EstimatorService

    service = EstimatorService()
    await DataProvider().sync_db_now()
    if not await service.run_and_store(force=True):
        warmup = await service.warmup_status()
        if warmup is not None:
            played, needed = warmup
            print(f"Not run: every team needs {needed} game days, the slowest has {played}.", file=sys.stderr)
        else:
            print("Not run: the estimator failed or has no snapshot data — see the log above.", file=sys.stderr)
        return 1

    data = await service.get_latest()
    predictions = data.get("predictions", []) if data else []
    as_of = predictions[0].get("as_of_date") if predictions else None
    print(f"Estimator results recomputed for snapshot {as_of}.")
    for row in (data or {}).get("rankings", []):
        print(f"  {row['rank']:>2}. {row['team_name']}: {row['total_expected_pts']:.1f} expected points")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--database-url", help="Postgres URL; falls back to DATABASE_URL env")
    args = parser.parse_args()
    if args.database_url:
        os.environ["DATABASE_URL"] = args.database_url
    if not os.environ.get("DATABASE_URL"):
        parser.error("no database given — pass --database-url or set DATABASE_URL")
    return asyncio.run(_main())


if __name__ == "__main__":
    sys.exit(main())

"""Re-materialize every feature vector from the raw rows already in Postgres.

Use this after a **feature change** — a new/removed/renamed feature column. The
nightly job only recomputes players who played that night, so a new column would
otherwise trickle in over weeks and read as NaN for everyone else.

Non-destructive, and the reason to prefer it over ``reinit_model_store.py``:

  * reads ``fs_player_games`` / ``fs_team_games`` — **no ESPN re-fetch**, so it
    takes seconds rather than hours (the month-parquet cache under
    ``research/data/espn_cache`` is gitignored and will not exist on a server)
  * truncates nothing — the raw game rows and the prediction history in
    ``model_eval_results`` / ``model_nightly_runs`` are never written to
  * pure upsert into the three ``fs_*_vectors`` tables, and idempotent: every
    feature is a pure function of the untouched raw rows, so re-running is safe

No SQL migration is needed for a feature change: vectors are stored as a JSONB
blob keyed by feature name, so new features are just new JSON keys.

The feature engineering runs **wherever this script runs**, not in the database —
so it can be run locally against a remote DB, and it uses the *local* checkout's
feature code.

Usage (from backend/):
    python scripts/refresh_feature_vectors.py --database-url postgresql://...
    DATABASE_URL=... python scripts/refresh_feature_vectors.py
    python scripts/refresh_feature_vectors.py --expect-feature USG_w10_mean
    python scripts/refresh_feature_vectors.py --through 2026-07-25   # replay testing

Restart the app afterwards so it loads the fresh vectors (and any new models).
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

VECTOR_TABLES = ["fs_player_vectors", "fs_team_allowed_vectors", "fs_team_own_vectors"]

logger = logging.getLogger("refresh_feature_vectors")


async def _counts(pool, tables: list[str]) -> dict[str, int]:
    out: dict[str, int] = {}
    async with pool.acquire() as conn:
        for t in tables:
            try:
                out[t] = await conn.fetchval(f"SELECT COUNT(*) FROM {t}")
            except Exception:
                out[t] = -1  # table missing
    return out


def _print_counts(title: str, counts: dict[str, int]) -> None:
    print(f"\n{title}")
    for t, n in counts.items():
        print(f"  {t:<28} {'(missing)' if n < 0 else f'{n:,}'}")


async def _main(args: argparse.Namespace) -> int:
    # Imported here so --database-url (exported below) is seen by app settings.
    from app.services.db_service import DBService
    from app.services.model_nightly_service import ModelNightlyService

    db = DBService()
    pool = await db._get_pool()
    if pool is None:
        print("ERROR: cannot connect — check --database-url / DATABASE_URL", file=sys.stderr)
        return 1

    # Israel TZ to match ModelNightlyService, so a manual run and the scheduled one
    # resolve "today" identically near midnight.
    through = (
        date.fromisoformat(args.through) if args.through
        else datetime.now(ZoneInfo("Asia/Jerusalem")).date()
    )
    _print_counts("Current vector counts:", await _counts(pool, VECTOR_TABLES))

    # Steps are inlined rather than calling ModelNightlyService._refresh_vectors_through
    # so the upsert result is actually checked — that helper discards it, which would
    # turn a failed write into a silent no-op.
    print(f"\nReading raw rows through {through} ...")
    player_recs, team_recs = await db.get_fs_rows_before(through + timedelta(days=1))
    if not player_recs or not team_recs:
        print(
            f"ERROR: no raw rows found (players={len(player_recs)}, teams={len(team_recs)}). "
            "Is fs_player_games populated? Run the bootstrap first.",
            file=sys.stderr,
        )
        await db.close()
        return 1
    print(f"  {len(player_recs):,} player-games, {len(team_recs):,} team-games")

    print("Recomputing feature vectors ...")
    t0 = time.perf_counter()
    vectors = await asyncio.to_thread(
        ModelNightlyService._vectors_from_records, player_recs, team_recs
    )
    players_v, allowed_v, own_v = vectors
    print(f"  built {len(players_v):,} player + {len(allowed_v)} allowed + {len(own_v)} own "
          f"vectors in {time.perf_counter() - t0:.1f}s")

    if not await db.upsert_feature_vectors(*vectors):
        print("ERROR: upsert failed — see the logged exception above. Nothing was changed.",
              file=sys.stderr)
        await db.close()
        return 1

    _print_counts("New vector counts:", await _counts(pool, VECTOR_TABLES))

    # Prove the write landed rather than trusting the return value alone.
    async with pool.acquire() as conn:
        fresh = await conn.fetchval(
            "SELECT COUNT(*) FROM fs_player_vectors WHERE updated_at >= NOW() - INTERVAL '10 minutes'"
        )
        print(f"\n  {fresh:,} player vectors stamped updated_at within the last 10 min")
        if args.expect_feature:
            have = await conn.fetchval(
                "SELECT COUNT(*) FROM fs_player_vectors WHERE features ? $1", args.expect_feature
            )
            total = await conn.fetchval("SELECT COUNT(*) FROM fs_player_vectors")
            print(f"  {have:,}/{total:,} player vectors carry {args.expect_feature!r}")
            if have < total:
                print(
                    f"ERROR: {total - have:,} vectors are missing {args.expect_feature!r} — is the "
                    "deployed code the version that emits it?",
                    file=sys.stderr,
                )
                await db.close()
                return 1

    print(f"\nDone in {time.perf_counter() - t0:.1f}s — vectors re-materialized; "
          "restart the app so it loads them (and any new models).")
    await db.close()
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--database-url", help="Postgres URL; falls back to DATABASE_URL env")
    parser.add_argument("--through", help="rebuild from rows up to this date (YYYY-MM-DD); default today")
    parser.add_argument(
        "--expect-feature",
        help="verify every player vector carries this feature key afterwards "
             "(e.g. USG_w10_mean); exits non-zero if any is missing",
    )
    args = parser.parse_args()

    if args.database_url:
        os.environ["DATABASE_URL"] = args.database_url
    if not os.environ.get("DATABASE_URL"):
        parser.error("no database given — pass --database-url or set DATABASE_URL")

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    raise SystemExit(asyncio.run(_main(args)))

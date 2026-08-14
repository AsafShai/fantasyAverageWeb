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


async def _feature_gap(db, service_cls) -> set[str] | None:
    """Features the deployed models need that the stored vectors don't carry.

    Same comparison the nightly makes on startup (_ensure_vectors_current), so a
    clean result here means that warning will not fire. None = not bootstrapped.
    """
    stored = await db.get_feature_vector_keys()
    if stored is None:
        return None
    return service_cls._required_stored_features() - stored


async def _report_gap(db, service_cls, pool, header: str) -> int:
    """Print the missing-feature verdict. Returns a process exit code."""
    missing = await _feature_gap(db, service_cls)
    print(f"\n{header}")
    if missing is None:
        print("  vectors not bootstrapped (or DB unreachable) - nothing to check")
        return 1
    if missing:
        print(f"  FAIL: {len(missing)} feature(s) the models need are absent from the vectors:")
        for f in sorted(missing):
            print(f"    - {f}")
        print("  The nightly will log its 'Feature vectors are missing N feature(s)' warning")
        print("  and read these as NaN. Re-run this script without --check to rebuild.")
        return 1
    print("  PASS: every feature the deployed models need is present in the stored vectors")

    # get_feature_vector_keys samples one row per table, which only characterises
    # the table while every row carries the same keys. A player who drops out of a
    # rebuild keeps their old blob, so check uniformity rather than trusting it.
    odd = await _nonuniform_player_vectors(pool)
    if odd:
        print(f"  WARN: {odd} player vector(s) carry a different feature-key set than the "
              "majority - stale rows the last rebuild did not rewrite")
    return 0


async def _nonuniform_player_vectors(pool) -> int:
    """Player vectors whose feature-key count differs from the most common one."""
    async with pool.acquire() as conn:
        return await conn.fetchval(
            """
            WITH sizes AS (
                SELECT player_id, (SELECT COUNT(*) FROM jsonb_object_keys(features)) AS n
                FROM fs_player_vectors
            ),
            modal AS (SELECT n FROM sizes GROUP BY n ORDER BY COUNT(*) DESC LIMIT 1)
            SELECT COUNT(*) FROM sizes WHERE n <> (SELECT n FROM modal)
            """
        )


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

    if args.check:
        code = await _report_gap(db, ModelNightlyService, pool, "Feature check (read-only, nothing written):")
        await db.close()
        return code

    # Steps are inlined rather than calling ModelNightlyService._refresh_vectors_through
    # so the upsert result is actually checked — that helper discards it, which would
    # turn a failed write into a silent no-op.
    print(f"\nReading raw rows through {through} ...")
    players, team_games = await db.get_fs_rows_before(through + timedelta(days=1))
    if players.empty or team_games.empty:
        print(
            f"ERROR: no raw rows found (players={len(players)}, teams={len(team_games)}). "
            "Is fs_player_games populated? Run the bootstrap first.",
            file=sys.stderr,
        )
        await db.close()
        return 1
    print(f"  {len(players):,} player-games, {len(team_games):,} team-games")

    print("Recomputing feature vectors ...")
    t0 = time.perf_counter()
    vectors = await asyncio.to_thread(
        ModelNightlyService._vectors_from_frames, players, team_games
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

    # Prove the write landed rather than trusting the return value alone. Every exit
    # stays inside the acquire block; closing the pool while a connection is checked
    # out makes Pool.close() block for 60s waiting on a connection it cannot reclaim.
    expect_failed = 0
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
            expect_failed = total - have

    if expect_failed:
        # Stricter than --check: this counts every stored row, including rows the
        # rebuild no longer produces (players dropped for staleness / sub-MIN_MINUTES),
        # which keep their old blob. --check asks the question the models actually ask.
        print(
            f"ERROR: {expect_failed:,} vector(s) lack {args.expect_feature!r}. If --check passes, "
            "these are stale rows no longer rebuilt, not a code-version problem.",
            file=sys.stderr,
        )
        await db.close()
        return 1

    # The real proof: not "did rows get written" but "does the store now satisfy
    # every feature the deployed models load". Same check the nightly runs.
    code = await _report_gap(db, ModelNightlyService, pool, "Verification:")

    print(f"\nDone in {time.perf_counter() - t0:.1f}s — vectors re-materialized; "
          "restart the app so it loads them (and any new models).")
    await db.close()
    return code


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--database-url", help="Postgres URL; falls back to DATABASE_URL env")
    parser.add_argument("--through", help="rebuild from rows up to this date (YYYY-MM-DD); default today")
    parser.add_argument(
        "--expect-feature",
        help="verify every player vector carries this feature key afterwards "
             "(e.g. USG_w10_mean); exits non-zero if any is missing",
    )
    parser.add_argument(
        "--check", action="store_true",
        help="read-only: report whether the stored vectors satisfy every feature the "
             "deployed models need, then exit. Writes nothing. Non-zero if any is missing",
    )
    args = parser.parse_args()

    if args.database_url:
        os.environ["DATABASE_URL"] = args.database_url
    if not os.environ.get("DATABASE_URL"):
        parser.error("no database given — pass --database-url or set DATABASE_URL")

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    raise SystemExit(asyncio.run(_main(args)))

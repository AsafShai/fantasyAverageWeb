"""List players whose ESPN position eligibility changed between two dates.

The baseline is the stored ESPN ADP snapshot (adp_provider_snapshots, provider='espn')
in effect on --since: the latest row dated on or before it, or the oldest stored row if
history starts later. The comparison side is a live ESPN fetch by default, or the snapshot
in effect on --until.

Every stored snapshot in between is also walked, so each change gets the first snapshot
date it appeared in. Snapshots are only written when ADP/rank content changes, so that
date is "seen by", not the exact day ESPN made the change.

Usage (from backend/):
    DATABASE_URL=... python scripts/espn_position_changes.py --since 2026-10-21
    DATABASE_URL=... python scripts/espn_position_changes.py --since 2026-10-21 --until 2026-11-10
    DATABASE_URL=... python scripts/espn_position_changes.py --since 2026-10-21 --json out.json

Read-only: it never writes to the database.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import date
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

ORDER = ["PG", "SG", "SF", "PF", "C"]
LIVE_URL = (
    "https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{season}"
    "/segments/0/leaguedefaults/1?view=kona_player_info"
)
LIVE_FILTER = {"players": {"sortDraftRanks": {"sortPriority": 1, "sortAsc": True, "value": "ROTO"}, "limit": 1200}}

# Stored payload row slots: (espn_id, name, adp, positions, ranking).
_ID, _NAME, _POS = 0, 1, 3


def _sorted(positions) -> tuple[str, ...]:
    return tuple(sorted(set(positions or []), key=lambda p: ORDER.index(p) if p in ORDER else 99))


def _index(payload: list) -> dict[int, tuple[str, tuple[str, ...]]]:
    out: dict[int, tuple[str, tuple[str, ...]]] = {}
    for row in payload:
        try:
            pid = int(row[_ID])
        except (TypeError, ValueError, IndexError):
            continue
        out[pid] = (row[_NAME], _sorted(row[_POS]))
    return out


async def _load_snapshots(dsn: str) -> list[tuple[date, dict]]:
    import asyncpg

    conn = await asyncpg.connect(dsn)
    try:
        rows = await conn.fetch(
            "SELECT snapshot_date, payload FROM adp_provider_snapshots"
            " WHERE provider = 'espn' ORDER BY snapshot_date"
        )
    finally:
        await conn.close()
    out = []
    for r in rows:
        payload = r["payload"]
        if isinstance(payload, str):
            payload = json.loads(payload)
        out.append((r["snapshot_date"], _index(payload)))
    return out


async def _load_live(season: int) -> dict:
    import httpx

    from app.services.adp_fetch import parse_espn_payload

    headers = {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json",
        "X-Fantasy-Filter": json.dumps(LIVE_FILTER),
    }
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.get(LIVE_URL.format(season=season), headers=headers)
        resp.raise_for_status()
        rows = parse_espn_payload(resp.json())
    return {r.espn_id: (r.name, _sorted(r.positions)) for r in rows if r.espn_id is not None}


def _as_of(snaps: list[tuple[date, dict]], day: date) -> Optional[tuple[date, dict]]:
    chosen = None
    for d, idx in snaps:
        if d <= day:
            chosen = (d, idx)
    return chosen


def _first_seen(snaps, pid: int, after: date, target: tuple[str, ...]) -> Optional[date]:
    for d, idx in snaps:
        if d > after and pid in idx and idx[pid][1] == target:
            return d
    return None


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--since", type=date.fromisoformat, required=True, help="baseline date (season start)")
    ap.add_argument("--until", type=date.fromisoformat, help="compare to stored snapshot on this date instead of live ESPN")
    ap.add_argument("--season", type=int, default=2027, help="ESPN season id for the live fetch (2027 = 2026-27)")
    ap.add_argument("--include-removals", action="store_true", help="also list players who lost a position")
    ap.add_argument("--json", type=Path, help="also write the result to this file")
    args = ap.parse_args()

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("DATABASE_URL is required", file=sys.stderr)
        return 2

    snaps = await _load_snapshots(dsn)
    if not snaps:
        print("No ESPN snapshots stored", file=sys.stderr)
        return 1
    base = _as_of(snaps, args.since) or snaps[0]
    base_date, base_idx = base

    if args.until:
        end = _as_of(snaps, args.until)
        if end is None:
            print(f"No snapshot on or before {args.until}", file=sys.stderr)
            return 1
        end_label, end_idx = end[0].isoformat(), end[1]
    else:
        end_label, end_idx = "live ESPN", await _load_live(args.season)

    changes = []
    for pid, (name, now_pos) in end_idx.items():
        if pid not in base_idx:
            continue
        before = base_idx[pid][1]
        gained = [p for p in now_pos if p not in before]
        lost = [p for p in before if p not in now_pos]
        if not gained and not (lost and args.include_removals):
            continue
        seen = _first_seen(snaps, pid, base_date, now_pos)
        changes.append(
            {
                "espn_id": pid,
                "name": name,
                "before": list(before),
                "after": list(now_pos),
                "gained": gained,
                "lost": lost,
                "first_seen": seen.isoformat() if seen else None,
            }
        )
    changes.sort(key=lambda c: (c["first_seen"] or "9999", c["name"]))

    print(f"Baseline: ESPN snapshot {base_date}  ->  {end_label}  ({len(base_idx)} players in baseline)\n")
    if not changes:
        print("No position changes.")
    for c in changes:
        delta = " ".join([f"+{p}" for p in c["gained"]] + [f"-{p}" for p in c["lost"]])
        before, after = "/".join(c["before"]) or "-", "/".join(c["after"]) or "-"
        print(f"{c['name']:<28} {before:<12} -> {after:<12} {delta:<10} first seen {c['first_seen'] or '(live only)'}")

    if args.json:
        args.json.write_text(json.dumps({"baseline": base_date.isoformat(), "compared_to": end_label, "changes": changes}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

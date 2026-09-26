"""Day-by-day history of each provider's ADP/rankings payload.

adp_cache keeps only the latest payload per provider (and a manual refresh deletes it), so
movement over time needs its own store. Every payload the live fetch serves is offered to
`record_snapshot`; a row is written only when its ADP or rankings content differs from the
provider's latest stored row, keyed by the UTC day the payload was fetched. Re-offering the
same payload (every 30-minute rebuild does) is a memory-only no-op.

The state of a provider on day D is its latest row with snapshot_date <= D, so a day with
no row -- nothing changed, or nobody woke the server -- still resolves.
"""

from __future__ import annotations

import hashlib
import json
import logging
from collections import OrderedDict
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Optional

from app.services.adp_cache import PAYLOAD_VERSION
from app.services.db_service import DBService

logger = logging.getLogger(__name__)

_DDL = """
CREATE TABLE IF NOT EXISTS adp_provider_snapshots (
    provider       TEXT NOT NULL,
    snapshot_date  DATE NOT NULL,
    payload        JSONB NOT NULL,
    row_version    INTEGER NOT NULL,
    adp_hash       TEXT NOT NULL,
    ranking_hash   TEXT NOT NULL,
    fetched_at     TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (provider, snapshot_date)
)
"""

# Row slots, shared with adp_fetch.AdpRow: (espn_id, name, adp, positions, ranking).
_ESPN_ID, _NAME, _ADP, _POSITIONS, _RANKING = range(5)
_PAYLOAD_CACHE_SIZE = 16


@dataclass(frozen=True)
class SnapshotMeta:
    provider: str
    snapshot_date: date
    adp_hash: str
    ranking_hash: str


_table_ready = False
# provider -> latest stored (date, adp_hash, ranking_hash); None once probed and empty.
_latest: dict[str, Optional[tuple[date, str, str]]] = {}
_payloads: "OrderedDict[tuple[str, date], list]" = OrderedDict()


def _slot(row, index: int):
    try:
        return row[index]
    except (IndexError, KeyError, TypeError):
        return None


def metric_hash(payload: list, slot: int) -> str:
    """Stable hash of one metric's values, independent of row order and the other metric."""
    items = sorted(
        (str(_slot(row, _ESPN_ID) or ""), str(_slot(row, _NAME) or ""), float(value))
        for row in payload
        if (value := _slot(row, slot)) is not None
    )
    return hashlib.sha1(json.dumps(items).encode()).hexdigest()


def payload_hashes(payload: list) -> tuple[str, str]:
    return metric_hash(payload, _ADP), metric_hash(payload, _RANKING)


def reset_snapshot_state() -> None:
    global _table_ready
    _table_ready = False
    _latest.clear()
    _payloads.clear()


async def _pool():
    return await DBService()._get_pool()


async def _ensure_table(conn) -> None:
    global _table_ready
    if _table_ready:
        return
    # Check first: CREATE TABLE IF NOT EXISTS still needs CREATE on the schema, so a
    # role without it fails even when the table is already there.
    if await conn.fetchval("SELECT to_regclass('adp_provider_snapshots') IS NOT NULL"):
        _table_ready = True
        return
    try:
        await conn.execute(_DDL)
    except Exception as e:
        raise RuntimeError(
            "adp_provider_snapshots is missing and this DB role cannot create it "
            f"({type(e).__name__}: {e}); apply migrations/create_adp_provider_snapshots.sql"
        ) from e
    _table_ready = True


async def record_snapshot(provider: str, payload: list, fetched_at: datetime) -> bool:
    """Store `payload` as `provider`'s state for fetched_at's UTC day if it changed.

    Returns True when a row was written. Never raises: history is a side channel and must
    not take the live ADP page down with it.
    """
    if not payload:
        return False
    adp_hash, ranking_hash = payload_hashes(payload)
    day = fetched_at.astimezone(timezone.utc).date()
    known = _latest.get(provider)
    if known is not None and known[1:] == (adp_hash, ranking_hash):
        return False

    pool = await _pool()
    if pool is None:
        return False
    try:
        async with pool.acquire() as conn:
            await _ensure_table(conn)
            if provider not in _latest:
                row = await conn.fetchrow(
                    "SELECT snapshot_date, adp_hash, ranking_hash FROM adp_provider_snapshots"
                    " WHERE provider = $1 ORDER BY snapshot_date DESC LIMIT 1",
                    provider,
                )
                _latest[provider] = (
                    (row["snapshot_date"], row["adp_hash"], row["ranking_hash"]) if row else None
                )
                known = _latest[provider]
                if known is not None and known[1:] == (adp_hash, ranking_hash):
                    return False
            if known is not None and known[0] > day:
                # An older payload (a stale fallback) must not overwrite newer history.
                return False
            await conn.execute(
                """
                INSERT INTO adp_provider_snapshots
                    (provider, snapshot_date, payload, row_version, adp_hash, ranking_hash, fetched_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (provider, snapshot_date) DO UPDATE
                SET payload = EXCLUDED.payload,
                    row_version = EXCLUDED.row_version,
                    adp_hash = EXCLUDED.adp_hash,
                    ranking_hash = EXCLUDED.ranking_hash,
                    fetched_at = EXCLUDED.fetched_at
                """,
                provider,
                day,
                [list(row) for row in payload],
                PAYLOAD_VERSION,
                adp_hash,
                ranking_hash,
                fetched_at,
            )
    except Exception:
        logger.exception("Failed to record %s ADP snapshot", provider)
        return False
    _latest[provider] = (day, adp_hash, ranking_hash)
    _payloads.pop((provider, day), None)
    logger.info("Recorded %s ADP snapshot for %s", provider, day.isoformat())
    return True


async def list_snapshots() -> list[SnapshotMeta]:
    """Every stored snapshot's identity (no payloads), oldest first per provider."""
    pool = await _pool()
    if pool is None:
        return []
    try:
        async with pool.acquire() as conn:
            await _ensure_table(conn)
            rows = await conn.fetch(
                "SELECT provider, snapshot_date, adp_hash, ranking_hash FROM adp_provider_snapshots"
                " WHERE row_version = $1 ORDER BY provider, snapshot_date",
                PAYLOAD_VERSION,
            )
    except Exception:
        logger.exception("Failed to list ADP snapshots")
        return []
    return [
        SnapshotMeta(
            provider=row["provider"],
            snapshot_date=row["snapshot_date"],
            adp_hash=row["adp_hash"],
            ranking_hash=row["ranking_hash"],
        )
        for row in rows
    ]


async def load_payload(provider: str, snapshot_date: date) -> Optional[list]:
    """The payload stored for exactly (provider, snapshot_date), memoized."""
    key = (provider, snapshot_date)
    cached = _payloads.get(key)
    if cached is not None:
        _payloads.move_to_end(key)
        return cached
    pool = await _pool()
    if pool is None:
        return None
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT payload FROM adp_provider_snapshots"
                " WHERE provider = $1 AND snapshot_date = $2 AND row_version = $3",
                provider,
                snapshot_date,
                PAYLOAD_VERSION,
            )
    except Exception:
        logger.exception("Failed to load %s ADP snapshot for %s", provider, snapshot_date)
        return None
    if row is None:
        return None
    payload = row["payload"]
    _payloads[key] = payload
    if len(_payloads) > _PAYLOAD_CACHE_SIZE:
        _payloads.popitem(last=False)
    return payload

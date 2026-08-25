"""Per-provider persistence for ADP/rankings source payloads.

Sleeper's docs ask for at most one fetch per day and to persist the result rather than
re-pulling it on every request. ESPN and Fantrax get the same policy so the fetch schedule
for one provider never depends on what the others are doing -- a Sleeper-shaped outage
shouldn't force a re-fetch of ESPN, and vice versa.

Two clocks per entry: `fetched_at` (last successful fetch) and `checked_at` (last attempt,
success or fail). A successful fetch is good for CACHE_TTL; a failed one is retried after
FAILURE_RETRY while still serving the last known-good payload -- a provider being briefly
down should not make it vanish from the blend for a day.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Awaitable, Callable, Optional

from app.services.db_service import DBService

logger = logging.getLogger(__name__)

CACHE_TTL = timedelta(hours=24)
FAILURE_RETRY = timedelta(minutes=15)
# Bump whenever the row shape a parser emits changes. A persisted payload written by an
# older shape is dropped rather than deserialized into the wrong fields.
PAYLOAD_VERSION = 2


@dataclass
class ProviderCacheEntry:
    provider: str
    payload: list
    source: str
    fetched_at: datetime
    checked_at: datetime
    ok: bool


_mem: dict[str, ProviderCacheEntry] = {}
_db_probed: set[str] = set()


def _due_for_refresh(entry: Optional[ProviderCacheEntry], now: datetime) -> bool:
    if entry is None:
        return True
    interval = CACHE_TTL if entry.ok else FAILURE_RETRY
    return now - entry.checked_at >= interval


async def _load_from_db(provider: str) -> Optional[ProviderCacheEntry]:
    pool = await DBService()._get_pool()
    if pool is None:
        return None
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT payload, source, fetched_at, row_version FROM adp_provider_cache"
                " WHERE provider = $1",
                provider,
            )
    except Exception:
        logger.exception("Failed to load cached %s payload from Neon", provider)
        return None
    if row is None:
        return None
    if row["row_version"] != PAYLOAD_VERSION:
        logger.info(
            "Discarding cached %s payload written at row_version=%s (current %s)",
            provider,
            row["row_version"],
            PAYLOAD_VERSION,
        )
        return None
    return ProviderCacheEntry(
        provider=provider,
        payload=row["payload"],
        source=row["source"],
        fetched_at=row["fetched_at"],
        checked_at=row["fetched_at"],
        ok=True,
    )


async def _save_to_db(entry: ProviderCacheEntry) -> None:
    pool = await DBService()._get_pool()
    if pool is None:
        return
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO adp_provider_cache (provider, payload, source, fetched_at, row_version)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (provider) DO UPDATE
                SET payload = EXCLUDED.payload,
                    source = EXCLUDED.source,
                    fetched_at = EXCLUDED.fetched_at,
                    row_version = EXCLUDED.row_version
                """,
                entry.provider,
                entry.payload,
                entry.source,
                entry.fetched_at,
                PAYLOAD_VERSION,
            )
    except Exception:
        logger.exception("Failed to persist %s payload to Neon", entry.provider)


async def get_or_refresh(
    provider: str,
    fetch: Callable[[], Awaitable[tuple[list, str]]],
) -> ProviderCacheEntry:
    """Serve `provider`'s cached rows, refreshing per the TTL policy above.

    Raises only when there is no cached payload anywhere (memory or Neon) and the fetch
    itself fails -- the same "no data at all" case the caller already has to handle.
    """
    now = datetime.now(timezone.utc)
    entry = _mem.get(provider)

    if entry is None and provider not in _db_probed:
        _db_probed.add(provider)
        db_entry = await _load_from_db(provider)
        if db_entry is not None:
            entry = db_entry
            _mem[provider] = entry

    if not _due_for_refresh(entry, now):
        return entry  # type: ignore[return-value]

    try:
        payload, source = await fetch()
    except Exception as e:
        if entry is not None:
            logger.warning(
                "ADP provider %s refresh failed, serving cached data from %s: %s: %s",
                provider,
                entry.fetched_at.isoformat(),
                type(e).__name__,
                e,
            )
            stale = ProviderCacheEntry(
                provider=provider,
                payload=entry.payload,
                source=entry.source,
                fetched_at=entry.fetched_at,
                checked_at=now,
                ok=False,
            )
            _mem[provider] = stale
            return stale
        raise

    fresh = ProviderCacheEntry(
        provider=provider, payload=payload, source=source, fetched_at=now, checked_at=now, ok=True
    )
    _mem[provider] = fresh
    await _save_to_db(fresh)
    return fresh


def reset_provider_cache() -> None:
    _mem.clear()
    _db_probed.clear()


async def invalidate(provider: Optional[str] = None) -> list[str]:
    """Force the next read of `provider` (or every provider) to re-fetch.

    Drops the persisted row too -- a manual refresh during a live draft window means
    "get me today's numbers", which a surviving Neon row would otherwise satisfy.
    """
    targets = [provider] if provider else sorted(set(_mem) | set(_db_probed))
    for key in targets:
        _mem.pop(key, None)
        _db_probed.discard(key)
    pool = await DBService()._get_pool()
    if pool is not None:
        try:
            async with pool.acquire() as conn:
                if provider:
                    await conn.execute("DELETE FROM adp_provider_cache WHERE provider = $1", provider)
                else:
                    await conn.execute("DELETE FROM adp_provider_cache")
        except Exception:
            logger.exception("Failed to clear persisted ADP cache for %s", provider or "all providers")
    return targets

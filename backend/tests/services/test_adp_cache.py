from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services import adp_cache


def _mock_pool(conn: AsyncMock) -> MagicMock:
    """asyncpg's Pool.acquire() is a plain call returning an async-context-manager
    object -- it is not itself awaited -- so this must be a MagicMock, not AsyncMock."""
    pool = MagicMock()
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=conn)
    cm.__aexit__ = AsyncMock(return_value=False)
    pool.acquire = MagicMock(return_value=cm)
    return pool


@pytest.fixture(autouse=True)
def no_real_db():
    """This module tests the in-memory TTL/stale-fallback policy in isolation; the
    Neon read/write path is exercised explicitly in the db-backed tests below."""
    adp_cache.reset_provider_cache()
    with patch("app.services.adp_cache.DBService") as mock_db:
        mock_db.return_value._get_pool = AsyncMock(return_value=None)
        yield
    adp_cache.reset_provider_cache()


@pytest.mark.asyncio
async def test_first_fetch_calls_through():
    fetch = AsyncMock(return_value=([(1, "A", 1.0, ["C"])], "src"))
    entry = await adp_cache.get_or_refresh("espn", fetch)
    assert entry.payload == [(1, "A", 1.0, ["C"])]
    assert entry.ok is True
    fetch.assert_awaited_once()


@pytest.mark.asyncio
async def test_within_ttl_serves_cached_without_refetching():
    fetch = AsyncMock(return_value=([(1, "A", 1.0, ["C"])], "src"))
    await adp_cache.get_or_refresh("espn", fetch)
    await adp_cache.get_or_refresh("espn", fetch)
    fetch.assert_awaited_once()


@pytest.mark.asyncio
async def test_expired_entry_refetches():
    fetch = AsyncMock(return_value=([(1, "A", 1.0, ["C"])], "src"))
    entry = await adp_cache.get_or_refresh("espn", fetch)
    stale_fetched_at = datetime.now(timezone.utc) - adp_cache.CACHE_TTL - timedelta(minutes=1)
    adp_cache._mem["espn"] = adp_cache.ProviderCacheEntry(
        provider="espn",
        payload=entry.payload,
        source=entry.source,
        fetched_at=stale_fetched_at,
        checked_at=stale_fetched_at,
        ok=True,
    )
    await adp_cache.get_or_refresh("espn", fetch)
    assert fetch.await_count == 2


@pytest.mark.asyncio
async def test_failed_refresh_serves_stale_payload_and_marks_not_ok():
    good = AsyncMock(return_value=([(1, "A", 1.0, ["C"])], "src"))
    entry = await adp_cache.get_or_refresh("espn", good)
    old_fetched_at = entry.fetched_at

    expired = datetime.now(timezone.utc) - adp_cache.CACHE_TTL - timedelta(minutes=1)
    adp_cache._mem["espn"].checked_at = expired

    failing = AsyncMock(side_effect=RuntimeError("espn is down"))
    stale = await adp_cache.get_or_refresh("espn", failing)
    assert stale.payload == [(1, "A", 1.0, ["C"])]  # last known-good payload preserved
    assert stale.fetched_at == old_fetched_at  # freshness timestamp is not lied about
    assert stale.ok is False


@pytest.mark.asyncio
async def test_failed_entry_retries_sooner_than_a_healthy_one():
    good = AsyncMock(return_value=([(1, "A", 1.0, ["C"])], "src"))
    await adp_cache.get_or_refresh("espn", good)

    just_failed = datetime.now(timezone.utc) - adp_cache.FAILURE_RETRY - timedelta(seconds=1)
    adp_cache._mem["espn"].ok = False
    adp_cache._mem["espn"].checked_at = just_failed

    retried = AsyncMock(return_value=([(2, "B", 2.0, [])], "src2"))
    entry = await adp_cache.get_or_refresh("espn", retried)
    assert entry.ok is True
    assert entry.payload == [(2, "B", 2.0, [])]
    retried.assert_awaited_once()


@pytest.mark.asyncio
async def test_no_cache_and_failed_fetch_raises():
    fetch = AsyncMock(side_effect=RuntimeError("down"))
    with pytest.raises(RuntimeError, match="down"):
        await adp_cache.get_or_refresh("espn", fetch)


@pytest.mark.asyncio
async def test_reset_clears_memory_and_db_probe_state():
    fetch = AsyncMock(return_value=([(1, "A", 1.0, ["C"])], "src"))
    await adp_cache.get_or_refresh("espn", fetch)
    assert "espn" in adp_cache._mem
    adp_cache.reset_provider_cache()
    assert adp_cache._mem == {}
    assert adp_cache._db_probed == set()


@pytest.mark.asyncio
async def test_loads_from_db_when_memory_is_cold():
    adp_cache.reset_provider_cache()
    fetched_at = datetime.now(timezone.utc) - timedelta(hours=1)
    row = {"payload": [[1, "A", 1.0, ["C"]]], "source": "db-src", "fetched_at": fetched_at}

    mock_conn = AsyncMock()
    mock_conn.fetchrow = AsyncMock(return_value=row)
    mock_pool = _mock_pool(mock_conn)

    fetch = AsyncMock()  # must not be called -- the DB row is fresh enough to serve as-is
    with patch("app.services.adp_cache.DBService") as mock_db:
        mock_db.return_value._get_pool = AsyncMock(return_value=mock_pool)
        entry = await adp_cache.get_or_refresh("espn", fetch)

    assert entry.payload == [[1, "A", 1.0, ["C"]]]
    assert entry.source == "db-src"
    fetch.assert_not_awaited()


@pytest.mark.asyncio
async def test_successful_fetch_persists_to_db():
    adp_cache.reset_provider_cache()
    mock_conn = AsyncMock()
    mock_conn.fetchrow = AsyncMock(return_value=None)  # nothing cached yet
    mock_conn.execute = AsyncMock()
    mock_pool = _mock_pool(mock_conn)

    fetch = AsyncMock(return_value=([(1, "A", 1.0, ["C"])], "src"))
    with patch("app.services.adp_cache.DBService") as mock_db:
        mock_db.return_value._get_pool = AsyncMock(return_value=mock_pool)
        await adp_cache.get_or_refresh("espn", fetch)

    mock_conn.execute.assert_awaited_once()
    args = mock_conn.execute.await_args.args
    assert "INSERT INTO adp_provider_cache" in args[0]
    assert args[1] == "espn"

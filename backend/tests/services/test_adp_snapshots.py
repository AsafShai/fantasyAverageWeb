from datetime import date, datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services import adp_snapshots


def _mock_pool(conn: AsyncMock) -> MagicMock:
    pool = MagicMock()
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=conn)
    cm.__aexit__ = AsyncMock(return_value=False)
    pool.acquire = MagicMock(return_value=cm)
    return pool


@pytest.fixture(autouse=True)
def clean_state():
    adp_snapshots.reset_snapshot_state()
    yield
    adp_snapshots.reset_snapshot_state()


def _conn(latest_row=None) -> AsyncMock:
    conn = AsyncMock()
    conn.fetchrow = AsyncMock(return_value=latest_row)
    conn.execute = AsyncMock()
    return conn


def _inserts(conn: AsyncMock) -> list:
    return [c for c in conn.execute.await_args_list if "INSERT INTO adp_provider_snapshots" in c.args[0]]


ROWS = [[1, "A", 10.0, ["C"], 12], [2, "B", 20.0, ["PG"], None]]
FETCHED = datetime(2026, 9, 22, 8, 0, tzinfo=timezone.utc)


def test_metric_hashes_are_independent_and_order_insensitive():
    adp_hash, rank_hash = adp_snapshots.payload_hashes(ROWS)
    assert adp_snapshots.payload_hashes(list(reversed(ROWS))) == (adp_hash, rank_hash)

    adp_moved = [[1, "A", 11.0, ["C"], 12], ROWS[1]]
    assert adp_snapshots.payload_hashes(adp_moved) == (adp_snapshots.metric_hash(adp_moved, 2), rank_hash)
    assert adp_snapshots.payload_hashes(adp_moved)[0] != adp_hash

    rank_moved = [[1, "A", 10.0, ["C"], 9], ROWS[1]]
    assert adp_snapshots.payload_hashes(rank_moved)[0] == adp_hash
    assert adp_snapshots.payload_hashes(rank_moved)[1] != rank_hash


@pytest.mark.asyncio
async def test_no_database_is_a_quiet_no_op():
    with patch("app.services.adp_snapshots.DBService") as db:
        db.return_value._get_pool = AsyncMock(return_value=None)
        assert await adp_snapshots.record_snapshot("espn", ROWS, FETCHED) is False


@pytest.mark.asyncio
async def test_first_payload_is_written_then_identical_payload_is_skipped_in_memory():
    conn = _conn(latest_row=None)
    with patch("app.services.adp_snapshots.DBService") as db:
        db.return_value._get_pool = AsyncMock(return_value=_mock_pool(conn))
        assert await adp_snapshots.record_snapshot("espn", ROWS, FETCHED) is True
        assert await adp_snapshots.record_snapshot("espn", ROWS, FETCHED) is False

    inserts = _inserts(conn)
    assert len(inserts) == 1
    args = inserts[0].args
    assert args[1] == "espn"
    assert args[2] == date(2026, 9, 22)
    assert conn.fetchrow.await_count == 1  # the latest-row probe runs once per provider


@pytest.mark.asyncio
async def test_payload_matching_latest_stored_row_is_not_rewritten():
    adp_hash, rank_hash = adp_snapshots.payload_hashes(ROWS)
    conn = _conn(
        latest_row={"snapshot_date": date(2026, 9, 20), "adp_hash": adp_hash, "ranking_hash": rank_hash}
    )
    with patch("app.services.adp_snapshots.DBService") as db:
        db.return_value._get_pool = AsyncMock(return_value=_mock_pool(conn))
        assert await adp_snapshots.record_snapshot("espn", ROWS, FETCHED) is False
    assert _inserts(conn) == []


@pytest.mark.asyncio
async def test_changed_payload_is_written_for_its_own_day():
    conn = _conn(latest_row={"snapshot_date": date(2026, 9, 21), "adp_hash": "x", "ranking_hash": "y"})
    with patch("app.services.adp_snapshots.DBService") as db:
        db.return_value._get_pool = AsyncMock(return_value=_mock_pool(conn))
        assert await adp_snapshots.record_snapshot("yahoo", ROWS, FETCHED) is True
    assert _inserts(conn)[0].args[2] == date(2026, 9, 22)


@pytest.mark.asyncio
async def test_older_payload_never_overwrites_newer_history():
    conn = _conn(latest_row={"snapshot_date": date(2026, 9, 25), "adp_hash": "x", "ranking_hash": "y"})
    with patch("app.services.adp_snapshots.DBService") as db:
        db.return_value._get_pool = AsyncMock(return_value=_mock_pool(conn))
        assert await adp_snapshots.record_snapshot("espn", ROWS, FETCHED) is False
    assert _inserts(conn) == []


@pytest.mark.asyncio
async def test_database_error_is_swallowed():
    conn = _conn(latest_row=None)
    conn.execute = AsyncMock(side_effect=RuntimeError("neon down"))
    with patch("app.services.adp_snapshots.DBService") as db:
        db.return_value._get_pool = AsyncMock(return_value=_mock_pool(conn))
        assert await adp_snapshots.record_snapshot("espn", ROWS, FETCHED) is False


@pytest.mark.asyncio
async def test_existing_table_skips_the_ddl():
    # CREATE TABLE IF NOT EXISTS needs CREATE on the schema even when the table exists,
    # so a role without it must not run the DDL at all once the table is there.
    conn = _conn()
    conn.fetchval = AsyncMock(return_value=True)
    with patch("app.services.adp_snapshots.DBService") as db:
        db.return_value._get_pool = AsyncMock(return_value=_mock_pool(conn))
        assert await adp_snapshots.record_snapshot("espn", ROWS, FETCHED) is True
    assert not [c for c in conn.execute.await_args_list if "CREATE TABLE" in c.args[0]]
    assert len(_inserts(conn)) == 1


@pytest.mark.asyncio
async def test_missing_table_is_created():
    conn = _conn()
    conn.fetchval = AsyncMock(return_value=False)
    with patch("app.services.adp_snapshots.DBService") as db:
        db.return_value._get_pool = AsyncMock(return_value=_mock_pool(conn))
        assert await adp_snapshots.record_snapshot("espn", ROWS, FETCHED) is True
    assert "CREATE TABLE IF NOT EXISTS adp_provider_snapshots" in conn.execute.await_args_list[0].args[0]


@pytest.mark.asyncio
async def test_missing_table_without_create_rights_fails_soft_and_names_the_migration(caplog):
    conn = _conn()
    conn.fetchval = AsyncMock(return_value=False)
    conn.execute = AsyncMock(side_effect=Exception("permission denied for schema public"))
    with patch("app.services.adp_snapshots.DBService") as db:
        db.return_value._get_pool = AsyncMock(return_value=_mock_pool(conn))
        assert await adp_snapshots.record_snapshot("espn", ROWS, FETCHED) is False
    assert "create_adp_provider_snapshots.sql" in caplog.text

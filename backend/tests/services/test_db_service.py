from datetime import date
from unittest.mock import AsyncMock

import pandas as pd
import pytest

from app.services.db_service import DBService


class FakeConn:
    def __init__(self, fetchrow_result=None, fetch_result=None, raise_on_fetch=False):
        self.fetchrow = AsyncMock(return_value=fetchrow_result)
        if raise_on_fetch:
            self.fetch = AsyncMock(side_effect=RuntimeError("boom"))
        else:
            self.fetch = AsyncMock(return_value=fetch_result or [])


class FakeAcquireCtx:
    def __init__(self, conn):
        self.conn = conn

    async def __aenter__(self):
        return self.conn

    async def __aexit__(self, *exc_info):
        return False


class FakePool:
    def __init__(self, conn):
        self.conn = conn

    def acquire(self):
        return FakeAcquireCtx(self.conn)


@pytest.fixture
def db_service():
    svc = object.__new__(DBService)
    svc._pool = None
    return svc


@pytest.mark.asyncio
async def test_aggregate_player_games_no_pool_returns_empty(db_service, monkeypatch):
    monkeypatch.setattr(db_service, "_get_pool", AsyncMock(return_value=None))

    df, actual_start, actual_end = await db_service.aggregate_player_games(
        date(2026, 1, 1), date(2026, 1, 10), "2025-26"
    )

    assert df.empty
    assert actual_start is None
    assert actual_end is None


@pytest.mark.asyncio
async def test_aggregate_player_games_success(db_service, monkeypatch):
    coverage = {"start_date": date(2026, 1, 2), "end_date": date(2026, 1, 9)}
    rows = [
        {
            "player_id": 1, "player_name": "Player One", "gp": 3,
            "pts": 60.0, "reb": 15.0, "ast": 9.0, "stl": 3.0, "blk": 1.0,
            "fgm": 21.0, "fga": 45.0, "ftm": 12.0, "fta": 14.0,
            "three_pm": 6.0, "min": 90.0,
            "fg_pct": 21.0 / 45.0, "ft_pct": 12.0 / 14.0,
        },
    ]
    conn = FakeConn(fetchrow_result=coverage, fetch_result=rows)
    monkeypatch.setattr(db_service, "_get_pool", AsyncMock(return_value=FakePool(conn)))

    df, actual_start, actual_end = await db_service.aggregate_player_games(
        date(2026, 1, 1), date(2026, 1, 10), "2025-26"
    )

    assert actual_start == date(2026, 1, 2)
    assert actual_end == date(2026, 1, 9)
    assert len(df) == 1
    row = df.iloc[0]
    assert row["gp"] == 3
    assert row["pts"] == 60.0
    assert row["fg_pct"] == pytest.approx(21.0 / 45.0)

    query_args = conn.fetchrow.call_args[0]
    assert "season" in query_args[0].lower() or "WHERE" in query_args[0]
    assert query_args[1:] == ("2025-26", date(2026, 1, 1), date(2026, 1, 10))


@pytest.mark.asyncio
async def test_aggregate_player_games_db_error_returns_empty(db_service, monkeypatch):
    conn = FakeConn(fetchrow_result=None, raise_on_fetch=False)
    conn.fetchrow = AsyncMock(side_effect=RuntimeError("connection lost"))
    monkeypatch.setattr(db_service, "_get_pool", AsyncMock(return_value=FakePool(conn)))

    df, actual_start, actual_end = await db_service.aggregate_player_games(
        date(2026, 1, 1), date(2026, 1, 10), "2025-26"
    )

    assert df.empty
    assert actual_start is None
    assert actual_end is None


@pytest.mark.asyncio
async def test_get_latest_game_date_no_pool_returns_none(db_service, monkeypatch):
    monkeypatch.setattr(db_service, "_get_pool", AsyncMock(return_value=None))

    result = await db_service.get_latest_game_date("2025-26")

    assert result is None


@pytest.mark.asyncio
async def test_get_latest_game_date_success(db_service, monkeypatch):
    conn = FakeConn(fetchrow_result={"d": date(2026, 4, 12)})
    monkeypatch.setattr(db_service, "_get_pool", AsyncMock(return_value=FakePool(conn)))

    result = await db_service.get_latest_game_date("2025-26")

    assert result == date(2026, 4, 12)
    query_args = conn.fetchrow.call_args[0]
    assert query_args[1:] == ("2025-26",)


@pytest.mark.asyncio
async def test_get_latest_game_date_no_rows_returns_none(db_service, monkeypatch):
    conn = FakeConn(fetchrow_result={"d": None})
    monkeypatch.setattr(db_service, "_get_pool", AsyncMock(return_value=FakePool(conn)))

    result = await db_service.get_latest_game_date("2025-26")

    assert result is None


@pytest.mark.asyncio
async def test_get_latest_game_date_db_error_returns_none(db_service, monkeypatch):
    conn = FakeConn()
    conn.fetchrow = AsyncMock(side_effect=RuntimeError("connection lost"))
    monkeypatch.setattr(db_service, "_get_pool", AsyncMock(return_value=FakePool(conn)))

    result = await db_service.get_latest_game_date("2025-26")

    assert result is None


@pytest.mark.asyncio
async def test_get_fs_rows_before_filters_min_minutes(db_service, monkeypatch):
    """The read gate must use the shared MIN_MINUTES knob (research/config.py),
    so training and the live store always see the same row population."""
    from model_stats_inference.research import config as rconfig

    conn = FakeConn(fetch_result=[])
    monkeypatch.setattr(db_service, "_get_pool", AsyncMock(return_value=FakePool(conn)))

    await db_service.get_fs_rows_before(date(2026, 1, 10))

    args = conn.fetch.call_args_list[0][0]
    assert "min >= $2" in args[0]
    assert args[2] == rconfig.MIN_MINUTES


@pytest.mark.asyncio
async def test_get_fs_rows_before_no_pool_returns_empty_lists(db_service, monkeypatch):
    monkeypatch.setattr(db_service, "_get_pool", AsyncMock(return_value=None))

    players, teams = await db_service.get_fs_rows_before(date(2026, 1, 10))

    assert players == []
    assert teams == []

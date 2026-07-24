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
        self.executemany = AsyncMock(return_value=None)


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


@pytest.mark.asyncio
async def test_aggregate_shooting_by_player_no_pool_returns_empty_df(db_service, monkeypatch):
    monkeypatch.setattr(db_service, "_get_pool", AsyncMock(return_value=None))

    df = await db_service.aggregate_shooting_by_player(["2025-26"])

    assert df.empty


@pytest.mark.asyncio
async def test_aggregate_shooting_by_player_success(db_service, monkeypatch):
    rows = [
        {
            "player_id": 1, "player_name": "Klay Thompson", "gp": 50,
            "fgm": 300.0, "fga": 700.0, "fg_pct": 300.0 / 700.0,
            "ftm": 80.0, "fta": 105.0, "ft_pct": 80.0 / 105.0,
            "fg3m": 140.0, "fg3a": 420.0, "fg3_pct": 140.0 / 420.0,
            "min": 1450.0,
        },
    ]
    conn = FakeConn(fetch_result=rows)
    monkeypatch.setattr(db_service, "_get_pool", AsyncMock(return_value=FakePool(conn)))

    df = await db_service.aggregate_shooting_by_player(["2025-26"])

    assert len(df) == 1
    row = df.iloc[0]
    assert row["player_id"] == 1
    assert row["fg3a"] == 420.0
    assert row["fg3_pct"] == pytest.approx(140.0 / 420.0)
    assert row["min"] == 1450.0
    assert "SUM(min)" in conn.fetch.call_args[0][0]

    query_args = conn.fetch.call_args[0]
    assert query_args[1] == ["2025-26"]
    assert query_args[2] is None
    assert query_args[3] is None


@pytest.mark.asyncio
async def test_aggregate_shooting_by_player_passes_seasons_and_bounds(db_service, monkeypatch):
    conn = FakeConn(fetch_result=[])
    monkeypatch.setattr(db_service, "_get_pool", AsyncMock(return_value=FakePool(conn)))

    await db_service.aggregate_shooting_by_player(
        ["2023-24", "2024-25"], start=date(2023, 10, 1), end=date(2025, 6, 1)
    )

    query_args = conn.fetch.call_args[0]
    assert query_args[1] == ["2023-24", "2024-25"]
    assert query_args[2] == date(2023, 10, 1)
    assert query_args[3] == date(2025, 6, 1)


@pytest.mark.asyncio
async def test_aggregate_shooting_by_player_db_error_returns_empty_df(db_service, monkeypatch):
    conn = FakeConn(raise_on_fetch=True)
    monkeypatch.setattr(db_service, "_get_pool", AsyncMock(return_value=FakePool(conn)))

    df = await db_service.aggregate_shooting_by_player(["2025-26"])

    assert df.empty


@pytest.mark.asyncio
async def test_get_games_since_no_pool_returns_empty_dict(db_service, monkeypatch):
    monkeypatch.setattr(db_service, "_get_pool", AsyncMock(return_value=None))

    result = await db_service.get_games_since(date(2026, 6, 1))

    assert result == {}


@pytest.mark.asyncio
async def test_get_games_since_success(db_service, monkeypatch):
    rows = [{"player_id": 1, "g": 7}, {"player_id": 2, "g": 2}]
    conn = FakeConn(fetch_result=rows)
    monkeypatch.setattr(db_service, "_get_pool", AsyncMock(return_value=FakePool(conn)))

    result = await db_service.get_games_since(date(2026, 6, 1))

    assert result == {1: 7, 2: 2}
    query_args = conn.fetch.call_args[0]
    assert query_args[1] == date(2026, 6, 1)


@pytest.mark.asyncio
async def test_get_games_since_db_error_returns_empty_dict(db_service, monkeypatch):
    conn = FakeConn(raise_on_fetch=True)
    monkeypatch.setattr(db_service, "_get_pool", AsyncMock(return_value=FakePool(conn)))

    result = await db_service.get_games_since(date(2026, 6, 1))

    assert result == {}


@pytest.mark.asyncio
async def test_get_usage_components_no_pool_returns_empty_df(db_service, monkeypatch):
    monkeypatch.setattr(db_service, "_get_pool", AsyncMock(return_value=None))

    df = await db_service.get_usage_components("2025-26", date(2025, 10, 22), date(2026, 6, 1))

    assert df.empty


@pytest.mark.asyncio
async def test_get_usage_components_success(db_service, monkeypatch):
    rows = [{
        "player_id": 1, "player_name": "Ayo Dosunmu", "game_id": "G1", "game_date": date(2026, 1, 1),
        "p_min": 32.0, "p_fga": 15.0, "p_fta": 3.0, "p_tov": 2.0,
        "t_fga": 85.0, "t_fta": 20.0, "t_tov": 12.0, "t_min": 240.0,
    }]
    conn = FakeConn(fetch_result=rows)
    monkeypatch.setattr(db_service, "_get_pool", AsyncMock(return_value=FakePool(conn)))

    df = await db_service.get_usage_components("2025-26", date(2025, 10, 22), date(2026, 6, 1))

    assert len(df) == 1
    row = df.iloc[0]
    assert row["player_id"] == 1
    assert row["t_min"] == 240.0
    query_args = conn.fetch.call_args[0]
    assert query_args[1:] == ("2025-26", date(2025, 10, 22), date(2026, 6, 1))


@pytest.mark.asyncio
async def test_get_usage_components_db_error_returns_empty_df(db_service, monkeypatch):
    conn = FakeConn(raise_on_fetch=True)
    monkeypatch.setattr(db_service, "_get_pool", AsyncMock(return_value=FakePool(conn)))

    df = await db_service.get_usage_components("2025-26", date(2025, 10, 22), date(2026, 6, 1))

    assert df.empty


@pytest.mark.asyncio
async def test_get_rankings_over_time_joins_gp(db_service, monkeypatch):
    rows = [{"date": date(2025, 11, 5), "team_id": 1, "team_name": "A", "rk_total": 61.5, "gp": 7}]
    conn = FakeConn(fetch_result=rows)
    monkeypatch.setattr(db_service, "_get_pool", AsyncMock(return_value=FakePool(conn)))

    result = await db_service.get_rankings_over_time("team_rankings_totals", None)

    assert result == rows
    query = conn.fetch.call_args[0][0]
    assert "LEFT JOIN team_daily_snapshot" in query
    assert "s.gp" in query


@pytest.mark.asyncio
async def test_get_rankings_over_time_with_team_ids_joins_gp(db_service, monkeypatch):
    conn = FakeConn(fetch_result=[])
    monkeypatch.setattr(db_service, "_get_pool", AsyncMock(return_value=FakePool(conn)))

    await db_service.get_rankings_over_time("team_rankings_averages", [1, 2])

    args = conn.fetch.call_args[0]
    assert "LEFT JOIN team_daily_snapshot" in args[0]
    assert args[1] == [1, 2]


@pytest.mark.asyncio
async def test_upsert_rankings_averages_preserves_tie_fraction(db_service, monkeypatch):
    conn = FakeConn()
    monkeypatch.setattr(db_service, "_get_pool", AsyncMock(return_value=FakePool(conn)))
    df = pd.DataFrame([{
        "team_id": 1, "team_name": "A",
        "FG%": 6.5, "FT%": 6.5, "3PM": 6.5, "REB": 6.5,
        "AST": 6.5, "STL": 6.5, "BLK": 6.5, "PTS": 6.5,
        "TOTAL_POINTS": 52.0,
    }])

    await db_service.upsert_rankings_averages(5, df)

    params = conn.executemany.call_args[0][1][0]
    assert params[4] == 6.5
    assert params[-1] == 52.0
    assert isinstance(params[-1], float)

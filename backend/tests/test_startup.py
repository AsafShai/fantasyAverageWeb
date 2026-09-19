from datetime import date
from unittest.mock import AsyncMock, patch

import pytest

from app import main


@pytest.mark.asyncio
async def test_derive_season_start_prefers_pro_team_schedules():
    with patch.object(
        main.schedule_service, "get_season_start_date", AsyncMock(return_value=date(2026, 10, 20))
    ), patch.object(main.NBAStatsService, "get_regular_season_start_date", AsyncMock()) as binary_search:
        assert await main.derive_season_start() == date(2026, 10, 20)

    binary_search.assert_not_awaited()


@pytest.mark.asyncio
async def test_derive_season_start_falls_back_to_the_scoreboard_search():
    with patch.object(
        main.schedule_service, "get_season_start_date", AsyncMock(return_value=None)
    ), patch.object(
        main.NBAStatsService,
        "get_regular_season_start_date",
        AsyncMock(return_value=date(2026, 10, 21)),
    ):
        assert await main.derive_season_start() == date(2026, 10, 21)


@pytest.mark.asyncio
async def test_derive_season_start_returns_none_when_both_sources_fail():
    with patch.object(
        main.schedule_service, "get_season_start_date", AsyncMock(return_value=None)
    ), patch.object(
        main.NBAStatsService, "get_regular_season_start_date", AsyncMock(return_value=None)
    ):
        assert await main.derive_season_start() is None

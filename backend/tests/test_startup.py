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


@pytest.mark.asyncio
async def test_lifespan_keeps_schedulers_referenced_and_cancels_them_on_shutdown():
    """Schedulers are spawned through background_tasks (strong refs, crash
    logging) and are cancelled on shutdown instead of being left dangling."""
    import asyncio
    from app.utils import background_tasks

    started = []

    def fake_scheduler(name):
        async def run():
            started.append(name)
            await asyncio.Event().wait()
        return run

    with patch.object(main, "derive_season_start", AsyncMock(return_value=None)), \
         patch.object(main.injury_service, "initialize", AsyncMock()), \
         patch.object(main.injury_service, "start_scheduler", fake_scheduler("injury")), \
         patch.object(main.estimator_scheduler, "start_scheduler", fake_scheduler("estimator")), \
         patch.object(main.model_nightly_scheduler, "start_scheduler", fake_scheduler("nightly")), \
         patch.object(main.nba_players_scheduler, "start_scheduler", fake_scheduler("players")), \
         patch.object(main.settings, "injury_scheduler_enabled", True), \
         patch.object(main.settings, "model_nightly_enabled", True), \
         patch.object(main.settings, "nba_players_refresh_enabled", True), \
         patch.object(main.DataProvider, "close", AsyncMock()), \
         patch.object(main.NBAStatsService, "close", AsyncMock()):
        async with main.lifespan(main.app):
            await asyncio.sleep(0)
            names = {t.get_name() for t in background_tasks._tasks}
            assert {"injury-scheduler", "estimator-scheduler",
                    "model-nightly-scheduler", "nba-players-scheduler"} <= names
            tasks = list(background_tasks._tasks)

    assert sorted(started) == ["estimator", "injury", "nightly", "players"]
    assert all(t.cancelled() for t in tasks)
    assert not background_tasks._tasks

from unittest.mock import AsyncMock, MagicMock

import pytest

import app.services.estimator_service as estimator_service_module
from app.services.estimator_service import EstimatorService, _NBA_AVG_PACE_FALLBACK


@pytest.fixture(autouse=True)
def reset_estimator_service_singleton():
    EstimatorService._instance = None
    EstimatorService._initialized = False
    yield
    EstimatorService._instance = None
    EstimatorService._initialized = False


@pytest.fixture
def estimator_service():
    return EstimatorService()


@pytest.mark.asyncio
async def test_get_nba_avg_pace_does_not_close_shared_nba_service(estimator_service, monkeypatch):
    """NBAStatsService is a shared singleton closed once at app shutdown —
    this caller runs concurrently with get_team_slot_pace_df's own use of it
    via the same asyncio.gather, so closing it here would break whichever
    call is still in flight. Regression test for that race condition."""
    nba_service = MagicMock()
    nba_service.get_nba_average_pace = AsyncMock(return_value=101.2)
    nba_service.close = AsyncMock()
    monkeypatch.setattr(estimator_service_module, 'NBAStatsService', lambda: nba_service)

    pace = await estimator_service._get_nba_avg_pace()

    assert pace == 101.2
    nba_service.close.assert_not_called()


@pytest.mark.asyncio
async def test_get_nba_avg_pace_falls_back_on_none(estimator_service, monkeypatch):
    nba_service = MagicMock()
    nba_service.get_nba_average_pace = AsyncMock(return_value=None)
    nba_service.close = AsyncMock()
    monkeypatch.setattr(estimator_service_module, 'NBAStatsService', lambda: nba_service)

    pace = await estimator_service._get_nba_avg_pace()

    assert pace == _NBA_AVG_PACE_FALLBACK


@pytest.mark.asyncio
async def test_get_nba_avg_pace_falls_back_on_exception(estimator_service, monkeypatch):
    nba_service = MagicMock()
    nba_service.get_nba_average_pace = AsyncMock(side_effect=RuntimeError("network down"))
    monkeypatch.setattr(estimator_service_module, 'NBAStatsService', lambda: nba_service)

    pace = await estimator_service._get_nba_avg_pace()

    assert pace == _NBA_AVG_PACE_FALLBACK

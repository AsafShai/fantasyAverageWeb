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


# --- overlapping runs / timezone (#3) ---------------------------------------

def _stub_run_inputs(svc, monkeypatch, estimate):
    """Everything around the Monte Carlo stubbed; `estimate` stands in for it."""
    import pandas as pd
    svc.db_service = MagicMock()
    svc.db_service.estimator_has_data = AsyncMock(return_value=False)
    for name in ("upsert_estimator_prediction", "upsert_estimator_ranking", "upsert_estimator_rank_probability"):
        setattr(svc.db_service, name, AsyncMock())
    monkeypatch.setattr(svc, "_get_snapshot_df", AsyncMock(return_value=pd.DataFrame({"x": [1]})))
    monkeypatch.setattr(svc, "_get_nba_avg_pace", AsyncMock(return_value=60.0))
    monkeypatch.setattr(estimator_service_module, "get_team_slot_pace_df", AsyncMock(return_value=pd.DataFrame()))
    fake_est = MagicMock()
    fake_est.return_value.estimate.side_effect = estimate
    monkeypatch.setattr("app.fantsy_estimator.FantasyEstimator", fake_est)
    return fake_est


def _estimate_result(*_args):
    import pandas as pd
    import time
    time.sleep(0.05)  # long enough for concurrent callers to overlap
    frame = pd.DataFrame({"team_id": [1]})
    return frame, frame, frame


@pytest.mark.asyncio
async def test_concurrent_runs_execute_estimator_once(estimator_service, monkeypatch):
    import asyncio
    fake_est = _stub_run_inputs(estimator_service, monkeypatch, _estimate_result)

    results = await asyncio.gather(*(estimator_service.run_and_store() for _ in range(5)))

    assert fake_est.return_value.estimate.call_count == 1
    assert sorted(results) == [False, False, False, False, True]


@pytest.mark.asyncio
async def test_waiting_caller_shares_in_flight_run(estimator_service, monkeypatch):
    import asyncio
    fake_est = _stub_run_inputs(estimator_service, monkeypatch, _estimate_result)

    first = asyncio.create_task(estimator_service.run_and_store())
    await asyncio.sleep(0)  # let it take the lock
    waited = await estimator_service.run_and_store(wait=True)

    assert await first is True
    assert waited is True
    assert fake_est.return_value.estimate.call_count == 1


@pytest.mark.asyncio
async def test_waiting_caller_reports_failed_in_flight_run(estimator_service, monkeypatch):
    import asyncio

    def boom(*_a):
        import time
        time.sleep(0.05)
        raise RuntimeError("mc failed")

    _stub_run_inputs(estimator_service, monkeypatch, boom)
    first = asyncio.create_task(estimator_service.run_and_store())
    await asyncio.sleep(0)

    assert await estimator_service.run_and_store(wait=True) is False
    assert await first is False


@pytest.mark.asyncio
async def test_lock_released_after_run_so_next_day_runs_again(estimator_service, monkeypatch):
    from datetime import date
    fake_est = _stub_run_inputs(estimator_service, monkeypatch, _estimate_result)
    day = {"today": date(2026, 1, 1)}
    monkeypatch.setattr(estimator_service_module, "israel_today", lambda: day["today"])

    assert await estimator_service.run_and_store() is True
    assert await estimator_service.run_and_store() is False  # same day: cached
    day["today"] = date(2026, 1, 2)
    assert await estimator_service.run_and_store() is True
    assert fake_est.return_value.estimate.call_count == 2


def test_israel_today_rolls_over_before_utc():
    from datetime import datetime, timezone
    # 23:30 UTC on Jan 1 is already 01:30 on Jan 2 in Israel (UTC+2 in winter)
    late_utc = datetime(2026, 1, 1, 23, 30, tzinfo=timezone.utc)
    assert estimator_service_module.israel_today(late_utc).isoformat() == "2026-01-02"


@pytest.mark.asyncio
async def test_run_stamps_cache_with_israel_date(estimator_service, monkeypatch):
    from datetime import date
    _stub_run_inputs(estimator_service, monkeypatch, _estimate_result)
    monkeypatch.setattr(estimator_service_module, "israel_today", lambda: date(2030, 5, 5))

    await estimator_service.run_and_store()

    assert estimator_service._cache_date == date(2030, 5, 5)


def test_scheduler_and_service_share_one_timezone():
    from app.services import estimator_scheduler
    assert estimator_scheduler.ISRAEL_TZ is estimator_service_module.ISRAEL_TZ

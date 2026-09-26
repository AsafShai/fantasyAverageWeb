from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import app.routes.estimator as estimator_route
from app.models.estimator import TeamRanking


@pytest.fixture(autouse=True)
def _reset_refresh_cooldown(monkeypatch):
    # module-level cooldown stamp: don't let one test's refresh suppress the next
    monkeypatch.setattr(estimator_route, "_last_refresh_at", None)


def _sample_ranking() -> dict:
    return {
        "team_id": 1,
        "team_name": "Alpha",
        "rank": 1,
        "total_expected_pts": 100.0,
        "expected_pts_fg_pct": 1.0,
        "expected_pts_ft_pct": 1.0,
        "expected_pts_three_pm": 1.0,
        "expected_pts_reb": 1.0,
        "expected_pts_ast": 1.0,
        "expected_pts_stl": 1.0,
        "expected_pts_blk": 1.0,
        "expected_pts_pts": 1.0,
        "projected_total_gp": 82.0,
    }


def _full_payload():
    return {
        "predictions": [],
        "rankings": [_sample_ranking()],
        "rank_probabilities": [],
    }


@patch("app.routes.estimator.DataProvider")
@patch("app.routes.estimator.EstimatorService")
def test_estimator_results_cached(mock_svc_cls, mock_prov_cls, test_client):
    mock_svc = MagicMock()
    mock_svc.get_latest = AsyncMock(return_value=_full_payload())
    mock_svc_cls.return_value = mock_svc
    mock_prov_cls.return_value = MagicMock()

    response = test_client.get("/api/estimator/results")
    assert response.status_code == 200
    data = response.json()
    assert len(data["rankings"]) == 1
    assert isinstance(TeamRanking(**data["rankings"][0]), TeamRanking)


@patch("app.routes.estimator.DataProvider")
@patch("app.routes.estimator.EstimatorService")
def test_estimator_results_no_data_404(mock_svc_cls, mock_prov_cls, test_client):
    mock_svc = MagicMock()
    mock_svc.get_latest = AsyncMock(return_value=None)
    mock_svc.run_and_store = AsyncMock(return_value=False)
    mock_svc_cls.return_value = mock_svc

    mock_prov = MagicMock()
    mock_prov.sync_db_now = AsyncMock(return_value=False)
    mock_prov_cls.return_value = mock_prov

    response = test_client.get("/api/estimator/results")
    assert response.status_code == 404


@patch("app.routes.estimator.DataProvider")
@patch("app.routes.estimator.EstimatorService")
def test_estimator_results_service_error_500(mock_svc_cls, mock_prov_cls, test_client):
    mock_svc = MagicMock()
    mock_svc.get_latest = AsyncMock(side_effect=RuntimeError("failure"))
    mock_svc_cls.return_value = mock_svc
    mock_prov_cls.return_value = MagicMock()

    response = test_client.get("/api/estimator/results")
    assert response.status_code == 500


@patch("app.routes.estimator.background_tasks.spawn")
@patch("app.routes.estimator.DataProvider")
@patch("app.routes.estimator.EstimatorService")
def test_estimator_results_cached_refreshes_in_tracked_background_task(
    mock_svc_cls, mock_prov_cls, mock_spawn, test_client
):
    mock_svc = MagicMock()
    mock_svc.get_latest = AsyncMock(return_value=_full_payload())
    mock_svc_cls.return_value = mock_svc
    mock_prov_cls.return_value = MagicMock()
    mock_spawn.side_effect = lambda coro, *, name: coro.close()

    response = test_client.get("/api/estimator/results")

    assert response.status_code == 200
    mock_spawn.assert_called_once()
    assert mock_spawn.call_args.kwargs["name"] == "estimator-refresh"


# --- refresh cooldown (#3) ---------------------------------------------------

@pytest.fixture
def fresh_cooldown(monkeypatch):
    clock = {"now": 1000.0}
    monkeypatch.setattr(estimator_route.time, "monotonic", lambda: clock["now"])
    return clock


@patch("app.routes.estimator.background_tasks.spawn")
@patch("app.routes.estimator.DataProvider")
@patch("app.routes.estimator.EstimatorService")
def test_repeat_visits_spawn_one_refresh_per_cooldown(
    mock_svc_cls, mock_prov_cls, mock_spawn, test_client, fresh_cooldown
):
    mock_svc = MagicMock()
    mock_svc.get_latest = AsyncMock(return_value=_full_payload())
    mock_svc_cls.return_value = mock_svc
    mock_spawn.side_effect = lambda coro, *, name: coro.close()

    for _ in range(5):
        assert test_client.get("/api/estimator/results").status_code == 200
    assert mock_spawn.call_count == 1

    fresh_cooldown["now"] += estimator_route.REFRESH_COOLDOWN_SECONDS + 1
    assert test_client.get("/api/estimator/results").status_code == 200
    assert mock_spawn.call_count == 2


@patch("app.routes.estimator.DataProvider")
@patch("app.routes.estimator.EstimatorService")
def test_inline_path_waits_for_in_flight_run(mock_svc_cls, mock_prov_cls, test_client, fresh_cooldown):
    mock_svc = MagicMock()
    mock_svc.get_latest = AsyncMock(side_effect=[None, _full_payload()])
    mock_svc.run_and_store = AsyncMock(return_value=True)
    mock_svc_cls.return_value = mock_svc
    mock_prov = MagicMock()
    mock_prov.sync_db_now = AsyncMock(return_value=True)
    mock_prov_cls.return_value = mock_prov

    assert test_client.get("/api/estimator/results").status_code == 200
    mock_svc.run_and_store.assert_awaited_once_with(wait=True)

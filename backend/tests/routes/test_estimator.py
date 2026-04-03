from unittest.mock import AsyncMock, MagicMock, patch

from app.models.estimator import TeamRanking


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

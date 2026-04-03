from datetime import date, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

from app.main import app
from app.models import HeatmapData
from app.models.base import Team
from app.models import RankingsOverTimeResponse
from app.services.db_service import DBService


def test_get_heatmap(test_client):
    """Test that the heatmap is returned correctly"""
    response = test_client.get("/api/analytics/heatmap")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(HeatmapData(**data), HeatmapData), f"Response is not a HeatmapData object: {data}"


def test_get_over_time_default_source(test_client):
    row = {"date": date(2025, 11, 5), "team_id": 1, "team_name": "A", "rk_pts": 2}
    inst = MagicMock()
    inst.get_rankings_over_time = AsyncMock(return_value=[row])
    app.dependency_overrides[DBService] = lambda: inst
    try:
        response = test_client.get("/api/analytics/over-time")
        assert response.status_code == 200
        body = response.json()
        assert isinstance(RankingsOverTimeResponse(**body), RankingsOverTimeResponse)
        inst.get_rankings_over_time.assert_awaited_once()
    finally:
        app.dependency_overrides.pop(DBService, None)


def test_get_over_time_snapshot_source(test_client):
    inst = MagicMock()
    inst.get_snapshot_over_time = AsyncMock(return_value=[])
    app.dependency_overrides[DBService] = lambda: inst
    try:
        response = test_client.get("/api/analytics/over-time?source=snapshot")
        assert response.status_code == 200
        inst.get_snapshot_over_time.assert_awaited_once_with(None)
    finally:
        app.dependency_overrides.pop(DBService, None)


def test_get_over_time_team_ids(test_client):
    inst = MagicMock()
    inst.get_rankings_over_time = AsyncMock(return_value=[])
    app.dependency_overrides[DBService] = lambda: inst
    try:
        response = test_client.get("/api/analytics/over-time?team_ids=1,2")
        assert response.status_code == 200
        inst.get_rankings_over_time.assert_awaited_once()
        call_args = inst.get_rankings_over_time.await_args
        assert call_args[0][1] == [1, 2]
    finally:
        app.dependency_overrides.pop(DBService, None)


def test_get_over_time_invalid_team_ids(test_client):
    response = test_client.get("/api/analytics/over-time?team_ids=1,abc")
    assert response.status_code == 400


@patch("app.services.league_service.LeagueService.get_heatmap_data", new_callable=AsyncMock)
def test_get_heatmap_with_date_range(mock_hm, test_client):
    mock_hm.return_value = HeatmapData(
        teams=[Team(team_id=1, team_name="T")],
        categories=["PTS"],
        data=[[1.0]],
        normalized_data=[[0.5]],
        ranks_data=[[1]],
        date_range_start=date(2025, 11, 1),
        date_range_end=date(2025, 11, 15),
    )
    response = test_client.get("/api/analytics/heatmap?start_date=2025-11-01&end_date=2025-11-15")
    assert response.status_code == 200
    mock_hm.assert_awaited_once()


def test_get_heatmap_future_end_date(test_client):
    future = (date.today() + timedelta(days=7)).isoformat()
    past = (date.today() - timedelta(days=30)).isoformat()
    response = test_client.get(f"/api/analytics/heatmap?start_date={past}&end_date={future}")
    assert response.status_code == 422


def test_get_heatmap_only_start_date(test_client):
    response = test_client.get("/api/analytics/heatmap?start_date=2025-11-01")
    assert response.status_code == 422


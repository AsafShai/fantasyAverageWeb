from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.depth_chart_service import DepthChartFetchError, DepthChartService


@pytest.fixture(autouse=True)
def reset_depth_chart_service_singleton():
    DepthChartService._instance = None
    DepthChartService._initialized = False
    yield
    DepthChartService._instance = None
    DepthChartService._initialized = False


def _depthchart_json():
    return {
        "team": {
            "id": "13",
            "displayName": "Lakers",
            "abbreviation": "LAL",
            "logo": "https://example.com/logo.png",
            "recordSummary": "10-5",
        },
        "depthchart": [
            {
                "positions": {
                    "pg": {
                        "position": {"abbreviation": "PG", "displayName": "Point Guard"},
                        "athletes": [
                            {
                                "id": "900",
                                "displayName": "Test Player",
                                "shortName": "T. Player",
                            }
                        ],
                    }
                }
            }
        ],
    }


@patch("app.routes.nba_teams.get_db_service")
def test_list_nba_teams(mock_get_db, test_client):
    response = test_client.get("/api/nba-teams/")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0
    assert "team_id" in data[0]
    assert "abbreviation" in data[0]
    assert "team_name" in data[0]


@patch("app.routes.nba_teams.get_db_service")
@patch("app.routes.nba_teams._depth_chart_service.get_depth_chart_raw")
def test_depthchart_success(mock_get_raw, mock_get_db, test_client):
    mock_get_raw.return_value = _depthchart_json()

    mock_db = MagicMock()
    mock_db.load_all_injury_statuses = AsyncMock(return_value=[])
    mock_get_db.return_value = mock_db

    response = test_client.get("/api/nba-teams/13/depthchart")
    assert response.status_code == 200
    body = response.json()
    assert body["team_id"] == "13"
    assert body["team_name"] == "Lakers"
    assert len(body["positions"]) == 1
    assert body["positions"][0]["abbreviation"] == "PG"
    assert body["positions"][0]["players"][0]["display_name"] == "Test Player"


@patch("app.routes.nba_teams.get_db_service")
@patch("app.routes.nba_teams._depth_chart_service.get_depth_chart_raw")
def test_depthchart_espn_404(mock_get_raw, mock_get_db, test_client):
    mock_get_raw.side_effect = DepthChartFetchError(99, is_network_error=False)
    mock_get_db.return_value = MagicMock(load_all_injury_statuses=AsyncMock(return_value=[]))

    response = test_client.get("/api/nba-teams/99/depthchart")
    assert response.status_code == 404


@patch("app.routes.nba_teams.get_db_service")
@patch("app.routes.nba_teams._depth_chart_service.get_depth_chart_raw")
def test_depthchart_timeout_502(mock_get_raw, mock_get_db, test_client):
    mock_get_raw.side_effect = DepthChartFetchError(13, is_network_error=True)
    mock_get_db.return_value = MagicMock(load_all_injury_statuses=AsyncMock(return_value=[]))

    response = test_client.get("/api/nba-teams/13/depthchart")
    assert response.status_code == 502

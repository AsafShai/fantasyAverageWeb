from unittest.mock import AsyncMock, MagicMock, patch

import httpx


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
@patch("app.routes.nba_teams.httpx.AsyncClient")
def test_list_nba_teams(mock_async_client, mock_get_db, test_client):
    response = test_client.get("/api/nba-teams/")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0
    assert "team_id" in data[0]
    assert "abbreviation" in data[0]
    assert "team_name" in data[0]
    mock_async_client.assert_not_called()


@patch("app.routes.nba_teams.get_db_service")
@patch("app.routes.nba_teams.httpx.AsyncClient")
def test_depthchart_success(mock_async_client, mock_get_db, test_client):
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = _depthchart_json()

    mock_http = MagicMock()
    mock_http.get = AsyncMock(return_value=mock_resp)
    mock_cm = MagicMock()
    mock_cm.__aenter__ = AsyncMock(return_value=mock_http)
    mock_cm.__aexit__ = AsyncMock(return_value=None)
    mock_async_client.return_value = mock_cm

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
@patch("app.routes.nba_teams.httpx.AsyncClient")
def test_depthchart_espn_404(mock_async_client, mock_get_db, test_client):
    mock_resp = MagicMock()
    mock_resp.status_code = 404
    mock_http = MagicMock()
    mock_http.get = AsyncMock(return_value=mock_resp)
    mock_cm = MagicMock()
    mock_cm.__aenter__ = AsyncMock(return_value=mock_http)
    mock_cm.__aexit__ = AsyncMock(return_value=None)
    mock_async_client.return_value = mock_cm
    mock_get_db.return_value = MagicMock(load_all_injury_statuses=AsyncMock(return_value=[]))

    response = test_client.get("/api/nba-teams/99/depthchart")
    assert response.status_code == 404


@patch("app.routes.nba_teams.get_db_service")
@patch("app.routes.nba_teams.httpx.AsyncClient")
def test_depthchart_timeout_502(mock_async_client, mock_get_db, test_client):
    mock_http = MagicMock()
    mock_http.get = AsyncMock(side_effect=httpx.TimeoutException("timeout"))
    mock_cm = MagicMock()
    mock_cm.__aenter__ = AsyncMock(return_value=mock_http)
    mock_cm.__aexit__ = AsyncMock(return_value=None)
    mock_async_client.return_value = mock_cm
    mock_get_db.return_value = MagicMock(load_all_injury_statuses=AsyncMock(return_value=[]))

    response = test_client.get("/api/nba-teams/13/depthchart")
    assert response.status_code == 502

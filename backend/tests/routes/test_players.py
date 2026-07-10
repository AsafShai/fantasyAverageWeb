from datetime import date, timedelta
from fastapi.testclient import TestClient
from app.main import app
from app.models import PaginatedPlayers, StatTimePeriod
from app.config import settings
from unittest.mock import patch

client = TestClient(app)


def test_get_all_players_default():
    """Test getting all players with default time period (season)"""
    response = client.get("/api/players/")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(PaginatedPlayers(**data), PaginatedPlayers)
    assert "players" in data
    assert "total_count" in data
    assert isinstance(data["players"], list)


def test_get_all_players_season():
    """Test getting all players with season time period"""
    response = client.get("/api/players/?time_period=season")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(PaginatedPlayers(**data), PaginatedPlayers)


def test_get_all_players_last_7():
    """Test getting all players with last_7 time period"""
    response = client.get("/api/players/?time_period=last_7")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(PaginatedPlayers(**data), PaginatedPlayers)


def test_get_all_players_last_15():
    """Test getting all players with last_15 time period"""
    response = client.get("/api/players/?time_period=last_15")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(PaginatedPlayers(**data), PaginatedPlayers)


def test_get_all_players_last_30():
    """Test getting all players with last_30 time period"""
    response = client.get("/api/players/?time_period=last_30")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(PaginatedPlayers(**data), PaginatedPlayers)


def test_get_all_players_invalid_time_period():
    """Test getting all players with invalid time period"""
    response = client.get("/api/players/?time_period=invalid")
    assert response.status_code == 422


def test_get_all_players_pagination():
    """Test pagination with time period"""
    response = client.get("/api/players/?page=1&limit=10&time_period=season")
    assert response.status_code == 200
    data = response.json()
    assert data["page"] == 1
    assert data["limit"] == 10
    assert len(data["players"]) <= 10


def test_get_all_players_different_stats_per_period():
    """Test that API accepts different time periods correctly (mock data will be same)"""
    season_response = client.get("/api/players/?limit=10&time_period=season")
    last_7_response = client.get("/api/players/?limit=10&time_period=last_7")

    assert season_response.status_code == 200
    assert last_7_response.status_code == 200

    season_data = season_response.json()
    last_7_data = last_7_response.json()

    assert len(season_data["players"]) > 0
    assert len(last_7_data["players"]) > 0


@patch('app.services.player_service.PlayerService.get_all_players')
def test_get_all_players_error(mock_get_all_players):
    """Test error handling when service fails"""
    from app.exceptions import ResourceNotFoundError
    mock_get_all_players.side_effect = ResourceNotFoundError("Service error")
    response = client.get("/api/players/")
    assert response.status_code == 404
    assert "Service error" in response.json()["detail"]


def test_get_all_players_custom_valid_range():
    """Custom period with a valid start/end within the season succeeds"""
    start = settings.season_start + timedelta(days=1)
    end = start + timedelta(days=5)
    response = client.get(f"/api/players/?time_period=custom&start={start}&end={end}")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(PaginatedPlayers(**data), PaginatedPlayers)


def test_get_all_players_custom_missing_start_and_end():
    response = client.get("/api/players/?time_period=custom")
    assert response.status_code == 422
    assert "requires both start and end" in response.json()["detail"]


def test_get_all_players_custom_missing_end():
    start = settings.season_start + timedelta(days=1)
    response = client.get(f"/api/players/?time_period=custom&start={start}")
    assert response.status_code == 422
    assert "requires both start and end" in response.json()["detail"]


def test_get_all_players_custom_start_after_end():
    start = settings.season_start + timedelta(days=5)
    end = settings.season_start + timedelta(days=1)
    response = client.get(f"/api/players/?time_period=custom&start={start}&end={end}")
    assert response.status_code == 422
    assert "start must be before end" in response.json()["detail"]


def test_get_all_players_custom_start_before_season():
    start = settings.season_start - timedelta(days=1)
    end = settings.season_start + timedelta(days=5)
    response = client.get(f"/api/players/?time_period=custom&start={start}&end={end}")
    assert response.status_code == 422
    assert "season start" in response.json()["detail"]


def test_get_all_players_custom_end_in_future():
    start = settings.season_start + timedelta(days=1)
    end = date.today() + timedelta(days=1)
    response = client.get(f"/api/players/?time_period=custom&start={start}&end={end}")
    assert response.status_code == 422
    assert "future" in response.json()["detail"]

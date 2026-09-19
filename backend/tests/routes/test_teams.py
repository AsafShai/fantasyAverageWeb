from datetime import date, timedelta
from fastapi.testclient import TestClient
from app.main import app
from app.models import Team, TeamDetail, TeamPlayers
from app.config import settings
from unittest.mock import patch
from fastapi import HTTPException
import pytest
from app.routes import teams as teams_route

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clear_team_detail_cache():
    teams_route.clear_team_detail_cache()
    yield
    teams_route.clear_team_detail_cache()


def test_get_teams_list():
    response = client.get("/api/teams")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list), f"Response is not a list: {data}"
    assert all(isinstance(Team(**item), Team) for item in data), f"Response is not a list of Team objects: {data}"

def test_get_team_detail():
    response = client.get("/api/teams/1")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(TeamDetail(**data), TeamDetail), f"Response is not a TeamDetail object: {data}"

def test_get_team_players():
    response = client.get("/api/teams/1/players")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(TeamPlayers(**data), TeamPlayers), f"Response is not a TeamPlayers object: {data}"

def test_get_team_detail_validation_error():
    response = client.get("/api/teams/0")
    assert response.status_code == 400
    assert "Team ID must be positive" in response.json()["detail"]

def test_get_team_players_validation_error():
    response = client.get("/api/teams/-1/players")
    assert response.status_code == 400
    assert "Team ID must be positive" in response.json()["detail"]


@patch('app.services.team_service.TeamService.get_teams_list')
def test_get_teams_list_error(mock_get_teams_list):
    from app.exceptions import ResourceNotFoundError
    mock_get_teams_list.side_effect = ResourceNotFoundError("Service error")
    response = client.get("/api/teams")
    assert response.status_code == 404
    assert "Service error" in response.json()["detail"]

@patch('app.services.team_service.TeamService.get_team_detail')
def test_get_team_detail_error(mock_get_team_detail):
    from app.exceptions import ResourceNotFoundError
    mock_get_team_detail.side_effect = ResourceNotFoundError("Service error")
    response = client.get("/api/teams/999")
    assert response.status_code == 404
    assert "Service error" in response.json()["detail"]

@patch('app.services.team_service.TeamService.get_team_players')
def test_get_team_players_error(mock_get_team_players):
    from app.exceptions import ResourceNotFoundError
    mock_get_team_players.side_effect = ResourceNotFoundError("Service error")
    response = client.get("/api/teams/999/players")
    assert response.status_code == 404
    assert "Service error" in response.json()["detail"]


def test_get_team_detail_with_time_period_default():
    """Test getting team detail with default time period (season)"""
    response = client.get("/api/teams/1")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(TeamDetail(**data), TeamDetail)


def test_get_team_detail_with_time_period_season():
    """Test getting team detail with season time period"""
    response = client.get("/api/teams/1?time_period=season")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(TeamDetail(**data), TeamDetail)


def test_get_team_detail_with_time_period_last_7():
    """Test getting team detail with last_7 time period"""
    response = client.get("/api/teams/1?time_period=last_7")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(TeamDetail(**data), TeamDetail)


def test_get_team_detail_with_time_period_last_15():
    """Test getting team detail with last_15 time period"""
    response = client.get("/api/teams/1?time_period=last_15")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(TeamDetail(**data), TeamDetail)


def test_get_team_detail_with_time_period_last_30():
    """Test getting team detail with last_30 time period"""
    response = client.get("/api/teams/1?time_period=last_30")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(TeamDetail(**data), TeamDetail)


def test_get_team_detail_with_invalid_time_period():
    """Test getting team detail with invalid time period"""
    response = client.get("/api/teams/1?time_period=invalid")
    assert response.status_code == 422


def test_get_team_detail_different_stats_per_period():
    """Test that API accepts different time periods correctly (mock data will be same)"""
    season_response = client.get("/api/teams/1?time_period=season")
    last_7_response = client.get("/api/teams/1?time_period=last_7")

    assert season_response.status_code == 200
    assert last_7_response.status_code == 200

    season_data = season_response.json()
    last_7_data = last_7_response.json()

    assert len(season_data["players"]) > 0
    assert len(last_7_data["players"]) > 0


def test_get_team_detail_custom_valid_range():
    start = settings.season_start + timedelta(days=1)
    end = start + timedelta(days=5)
    response = client.get(f"/api/teams/1?time_period=custom&start={start}&end={end}")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(TeamDetail(**data), TeamDetail)


def test_get_team_detail_custom_missing_start_and_end():
    response = client.get("/api/teams/1?time_period=custom")
    assert response.status_code == 422
    assert "requires both start and end" in response.json()["detail"]


def test_get_team_detail_custom_start_after_end():
    start = settings.season_start + timedelta(days=5)
    end = settings.season_start + timedelta(days=1)
    response = client.get(f"/api/teams/1?time_period=custom&start={start}&end={end}")
    assert response.status_code == 422
    assert "start must be before end" in response.json()["detail"]


def test_get_team_detail_custom_end_in_future():
    start = settings.season_start + timedelta(days=1)
    end = date.today() + timedelta(days=1)
    response = client.get(f"/api/teams/1?time_period=custom&start={start}&end={end}")
    assert response.status_code == 422
    assert "future" in response.json()["detail"]

def test_team_detail_preset_served_from_cache_within_ttl():
    first = client.get("/api/teams/1?time_period=last_7")
    assert first.status_code == 200
    with patch.object(teams_route.TeamService, "get_team_detail") as never_called:
        second = client.get("/api/teams/1?time_period=last_7")
    assert second.status_code == 200
    assert second.json() == first.json()
    never_called.assert_not_called()


def test_team_detail_cache_keyed_by_team_and_period():
    client.get("/api/teams/1?time_period=last_7")
    assert set(teams_route._response_cache) == {(1, "last_7")}
    client.get("/api/teams/1?time_period=last_30")
    client.get("/api/teams/3?time_period=last_7")
    assert set(teams_route._response_cache) == {(1, "last_7"), (1, "last_30"), (3, "last_7")}


def test_team_detail_custom_range_is_not_cached():
    start = settings.season_start
    end = min(start + timedelta(days=7), date.today() - timedelta(days=1))
    response = client.get(f"/api/teams/1?time_period=custom&start={start}&end={end}")
    assert response.status_code in (200, 422)
    assert teams_route._response_cache == {}


def test_team_detail_cache_expires_after_ttl():
    client.get("/api/teams/1?time_period=last_7")
    stamp, payload = teams_route._response_cache[(1, "last_7")]
    teams_route._response_cache[(1, "last_7")] = (stamp - teams_route._RESPONSE_CACHE_TTL_S - 1, payload)
    with patch.object(teams_route.TeamService, "get_team_detail", wraps=teams_route.TeamService().get_team_detail) as refetched:
        client.get("/api/teams/1?time_period=last_7")
    refetched.assert_called_once()


def test_team_detail_404_is_not_cached():
    response = client.get("/api/teams/9999")
    assert response.status_code == 404
    assert teams_route._response_cache == {}

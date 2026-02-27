from fastapi.testclient import TestClient
from app.main import app
from app.models import Team, TeamDetail, TeamPlayers
from unittest.mock import patch
from fastapi import HTTPException

client = TestClient(app)


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
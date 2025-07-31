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
from app.models import LeagueSummary
from app.models import LeagueShotsData
from unittest.mock import patch

def test_league_summary(test_client):
    response = test_client.get("/api/league/summary")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(LeagueSummary(**data), LeagueSummary), f"Response is not a LeagueSummary object: {data}"

def test_league_shots(test_client):
    response = test_client.get("/api/league/shots")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(LeagueShotsData(**data), LeagueShotsData), f"Response is not a LeagueShotsData object: {data}"

@patch('app.services.league_service.LeagueService.get_league_summary')
def test_league_summary_error(mock_get_summary, test_client):
    mock_get_summary.side_effect = ValueError("Service error")
    response = test_client.get("/api/league/summary")
    assert response.status_code == 404

@patch('app.services.league_service.LeagueService.get_league_shots_data')
def test_league_shots_error(mock_get_shots, test_client):
    mock_get_shots.side_effect = ValueError("Service error")
    response = test_client.get("/api/league/shots")
    assert response.status_code == 404
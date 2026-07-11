from app.models import LeagueSummary
from app.models import LeagueShotsData
from app.models import DraftReport
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

def test_draft_report(test_client):
    response = test_client.get("/api/league/draft-report")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(DraftReport(**data), DraftReport), f"Response is not a DraftReport object: {data}"
    assert len(data["picks"]) == 2
    assert data["picks"][0] == {
        "pick": 1, "round": 1, "team_id": 1, "team_name": "Team Alpha", "player_name": "Player A1"
    }

@patch('app.services.draft_report_service.DraftReportService.get_draft_report')
def test_draft_report_error(mock_get_draft_report, test_client):
    from app.exceptions import ResourceNotFoundError
    mock_get_draft_report.side_effect = ResourceNotFoundError("No draft picks found for this league")
    response = test_client.get("/api/league/draft-report")
    assert response.status_code == 404
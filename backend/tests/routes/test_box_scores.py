from datetime import date
from unittest.mock import AsyncMock, patch

from app.config import settings
from app.services.box_score_service import BoxScoreNotFound, BoxScoreUnavailable


def test_season_window_returns_the_regular_season(test_client, monkeypatch):
    monkeypatch.setattr(settings, "season_start", date(2026, 10, 20))
    monkeypatch.setattr(settings, "season_end", date(2027, 4, 11))
    response = test_client.get("/api/nba/season")
    assert response.status_code == 200
    assert response.json() == {"start": "2026-10-20", "end": "2027-04-11"}


@patch("app.routes.box_scores.scoreboard_for", new_callable=AsyncMock)
def test_scoreboard_returns_the_slate(mock_scoreboard, test_client):
    mock_scoreboard.return_value = {"date": "2026-10-25", "games": []}
    response = test_client.get("/api/nba/scoreboard?date=2026-10-25")
    assert response.status_code == 200
    assert response.json()["date"] == "2026-10-25"
    mock_scoreboard.assert_awaited_once()


def test_scoreboard_rejects_a_bad_date(test_client):
    response = test_client.get("/api/nba/scoreboard?date=tomorrow")
    assert response.status_code == 422


@patch("app.routes.box_scores.scoreboard_for", new_callable=AsyncMock)
def test_scoreboard_maps_an_espn_outage_to_503(mock_scoreboard, test_client):
    mock_scoreboard.side_effect = BoxScoreUnavailable("down")
    response = test_client.get("/api/nba/scoreboard?date=2026-10-25")
    assert response.status_code == 503


@patch("app.routes.box_scores.boxscore_for", new_callable=AsyncMock)
def test_boxscore_returns_the_game(mock_box, test_client):
    mock_box.return_value = {"game_id": "100", "status": "final"}
    response = test_client.get("/api/nba/games/100/boxscore")
    assert response.status_code == 200
    assert response.json()["game_id"] == "100"


def test_boxscore_rejects_a_non_numeric_id(test_client):
    response = test_client.get("/api/nba/games/not-a-game/boxscore")
    assert response.status_code == 404


@patch("app.routes.box_scores.boxscore_for", new_callable=AsyncMock)
def test_boxscore_maps_a_missing_game_to_404(mock_box, test_client):
    mock_box.side_effect = BoxScoreNotFound("missing")
    response = test_client.get("/api/nba/games/100/boxscore")
    assert response.status_code == 404


@patch("app.routes.box_scores.slate_values", new_callable=AsyncMock)
def test_scoreboard_values_returns_the_slate_values(mock_values, test_client):
    mock_values.return_value = {"date": "2026-10-25", "complete": True, "players": []}
    response = test_client.get("/api/nba/scoreboard/values?date=2026-10-25")
    assert response.status_code == 200
    assert response.json()["complete"] is True


@patch("app.routes.box_scores.slate_values", new_callable=AsyncMock)
def test_scoreboard_values_maps_an_espn_outage_to_503(mock_values, test_client):
    mock_values.side_effect = BoxScoreUnavailable("down")
    response = test_client.get("/api/nba/scoreboard/values?date=2026-10-25")
    assert response.status_code == 503

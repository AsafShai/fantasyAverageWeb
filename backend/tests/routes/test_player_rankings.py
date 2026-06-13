from fastapi.testclient import TestClient
from unittest.mock import patch
from app.main import app
from app.models import Player, PlayerStats

client = TestClient(app)


def _sample_player(name: str = "P1") -> Player:
    return Player(
        player_name=name,
        pro_team="LAL",
        positions=["PG"],
        stats=PlayerStats(
            pts=20, reb=5, ast=5, stl=1, blk=0.5,
            fgm=8, fga=17, ftm=4, fta=5,
            fg_percentage=0.47, ft_percentage=0.85,
            three_pm=2, minutes=30, gp=70,
        ),
        team_id=1,
        status="ONTEAM",
        injured=False,
    )


def test_get_player_rankings_returns_list():
    response = client.get("/api/player-rankings/")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0


def test_get_player_rankings_player_shape():
    response = client.get("/api/player-rankings/")
    assert response.status_code == 200
    player = response.json()[0]
    assert "player_name" in player
    assert "pro_team" in player
    assert "positions" in player
    assert "stats" in player
    stats = player["stats"]
    for field in ["pts", "reb", "ast", "stl", "blk", "three_pm", "fg_percentage", "ft_percentage", "gp", "minutes"]:
        assert field in stats


@patch("app.services.player_rankings_service.PlayerRankingsService.get_player_rankings")
def test_get_player_rankings_error(mock_get):
    from app.exceptions import ResourceNotFoundError
    mock_get.side_effect = ResourceNotFoundError("No players found")
    response = client.get("/api/player-rankings/")
    assert response.status_code == 404
    assert "No players found" in response.json()["detail"]

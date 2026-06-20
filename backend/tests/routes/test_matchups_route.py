import pytest
import pandas as pd
from unittest.mock import AsyncMock, MagicMock
from fastapi.testclient import TestClient

from app.main import app

_MOCK_RANKS = {
    'LAL': {'pts': 28, 'reb': 25, 'ast': 12, 'stl': 8, 'blk': 30, 'three_pm': 15, 'fg_pct': 22},
    'CHA': {'pts': 5, 'reb': 8, 'ast': 10, 'stl': 20, 'blk': 3, 'three_pm': 6, 'fg_pct': 7},
}
_MOCK_PACE = {'LAL': 97.5, 'CHA': 101.8}
_MOCK_GAMES = {'LAL': 'CHA', 'CHA': 'LAL'}
_MOCK_PLAYERS = pd.DataFrame([
    {'player_name': 'Anthony Davis', 'pro_team': 'LAL', 'positions': ['C'], 'status': 'ONTEAM', 'team_id': 1},
    {'player_name': 'Player Off', 'pro_team': 'BOS', 'positions': ['PG'], 'status': 'ONTEAM', 'team_id': 2},
])


@pytest.fixture
def mock_services(monkeypatch):
    svc = MagicMock()
    svc.get_defensive_ranks.return_value = _MOCK_RANKS
    svc.get_team_pace.return_value = _MOCK_PACE
    svc.get_games_today = AsyncMock(return_value=_MOCK_GAMES)
    svc.get_pace_badge.return_value = 'Fast'

    provider = MagicMock()
    provider.get_players_df = AsyncMock(return_value=_MOCK_PLAYERS)

    monkeypatch.setattr('app.routes.matchups._matchup_service', svc)
    monkeypatch.setattr('app.routes.matchups._data_provider', provider)
    return svc, provider


def test_returns_only_players_with_games(mock_services):
    client = TestClient(app)
    resp = client.get('/api/matchups/today')
    assert resp.status_code == 200
    data = resp.json()
    # Only LAL (Anthony Davis) has a game; BOS has no game in mock
    assert len(data) == 1
    assert data[0]['player_name'] == 'Anthony Davis'


def test_response_shape(mock_services):
    client = TestClient(app)
    data = client.get('/api/matchups/today').json()
    player = data[0]
    assert player['opponent'] == 'CHA'
    assert player['pace_badge'] == 'Fast'
    assert player['def_ranks']['blk'] == 3  # CHA (opponent) ranks: blk=3
    assert set(player['def_ranks'].keys()) == {'pts', 'reb', 'ast', 'stl', 'blk', 'three_pm', 'fg_pct'}


def test_returns_empty_on_no_games(mock_services):
    svc, provider = mock_services
    svc.get_games_today = AsyncMock(return_value={})
    client = TestClient(app)
    resp = client.get('/api/matchups/today')
    assert resp.status_code == 200
    assert resp.json() == []


def test_returns_empty_on_service_error(mock_services):
    svc, _ = mock_services
    svc.get_games_today = AsyncMock(side_effect=Exception('nba_api down'))
    client = TestClient(app)
    resp = client.get('/api/matchups/today')
    assert resp.status_code == 200
    assert resp.json() == []

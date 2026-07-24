import pytest
import pandas as pd
from unittest.mock import AsyncMock, MagicMock
from fastapi.testclient import TestClient

from app.main import app
from app.services.nba_matchup_service import GameInfo

_MOCK_RANKS = {
    'LAL': {'pts': 28, 'reb': 25, 'ast': 12, 'stl': 8, 'blk': 30, 'three_pm': 15, 'fg_pct': 22},
    'CHA': {'pts': 5, 'reb': 8, 'ast': 10, 'stl': 20, 'blk': 3, 'three_pm': 6, 'fg_pct': 7},
}
_MOCK_VALUES = {
    'LAL': {'pts': 113.2, 'reb': 43.1, 'ast': 24.5, 'stl': 7.2, 'blk': 5.8, 'three_pm': 13.4, 'fg_pct': 0.467},
    'CHA': {'pts': 119.8, 'reb': 46.2, 'ast': 26.1, 'stl': 8.4, 'blk': 4.9, 'three_pm': 14.2, 'fg_pct': 0.481},
}
_MOCK_LEAGUE_AVG_VALUES = {
    'pts': 115.0, 'reb': 44.0, 'ast': 25.0, 'stl': 7.8, 'blk': 5.2, 'three_pm': 13.8, 'fg_pct': 0.473,
}
_MOCK_PACE = {'LAL': 97.5, 'CHA': 101.8}
_MOCK_GAMES = {
    'LAL': GameInfo(opponent='CHA', is_home=True),
    'CHA': GameInfo(opponent='LAL', is_home=False),
}
_MOCK_PLAYERS = pd.DataFrame([
    {'Name': 'Anthony Davis', 'Pro Team': 'LAL', 'Positions': 'C', 'status': 'ONTEAM', 'team_id': 1},
    {'Name': 'Player Off', 'Pro Team': 'BOS', 'Positions': 'PG', 'status': 'ONTEAM', 'team_id': 2},
])


@pytest.fixture
def mock_services(monkeypatch):
    # The route caches responses per slate; clear so tests stay independent.
    monkeypatch.setattr('app.routes.matchups._response_cache', {})
    svc = MagicMock()
    svc.get_all_def_data = AsyncMock(return_value={
        'ranks': _MOCK_RANKS,
        'values': _MOCK_VALUES,
        'league_avg_values': _MOCK_LEAGUE_AVG_VALUES,
        'pace': _MOCK_PACE,
    })
    svc.get_games_today = AsyncMock(return_value=_MOCK_GAMES)
    svc.get_schedule_date = MagicMock(return_value='2026-01-15')

    provider = MagicMock()
    provider.get_players_df = AsyncMock(return_value=_MOCK_PLAYERS)

    depth_chart_svc = MagicMock()
    depth_chart_svc.get_on_depth_chart_names = AsyncMock(return_value={'LAL': {'anthonydavis'}})

    monkeypatch.setattr('app.routes.matchups._matchup_service', svc)
    monkeypatch.setattr('app.routes.matchups._data_provider', provider)
    monkeypatch.setattr('app.routes.matchups._depth_chart_service', depth_chart_svc)
    monkeypatch.setattr(
        'app.routes.matchups.DBService',
        lambda: MagicMock(
            load_all_injury_statuses=AsyncMock(return_value=[]),
            get_recent_game_dates=AsyncMock(return_value=[]),
        ),
    )
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
    assert player['def_ranks']['blk'] == 3  # CHA (opponent) ranks: blk=3
    assert set(player['def_ranks'].keys()) == {'pts', 'reb', 'ast', 'stl', 'blk', 'three_pm', 'fg_pct'}
    assert player['def_values']['pts'] == 119.8
    assert set(player['def_values'].keys()) == {'pts', 'reb', 'ast', 'stl', 'blk', 'three_pm', 'fg_pct'}
    assert player['league_avg_def_values']['pts'] == 115.0
    assert player['positions'] == ['C']
    assert 'pace' in player
    assert 'league_avg_pace' in player
    assert 'pace_badge' not in player
    assert player['game_date'] == '2026-01-15'
    assert player['on_depth_chart'] is True
    assert player['injury_status'] is None


def test_tags_player_not_on_depth_chart(mock_services, monkeypatch):
    depth_chart_svc = MagicMock()
    depth_chart_svc.get_on_depth_chart_names = AsyncMock(return_value={'LAL': set()})
    monkeypatch.setattr('app.routes.matchups._depth_chart_service', depth_chart_svc)
    client = TestClient(app)
    data = client.get('/api/matchups/today').json()
    # Backend tags only -- filtering happens client-side, so the player still
    # appears in the response even when absent from the depth chart.
    assert len(data) == 1
    assert data[0]['on_depth_chart'] is False


def test_tags_injury_status_from_db(mock_services, monkeypatch):
    monkeypatch.setattr(
        'app.routes.matchups.DBService',
        lambda: MagicMock(
            load_all_injury_statuses=AsyncMock(return_value=[
                {'team': 'LAL', 'player': 'Anthony Davis', 'status': 'Out'},
            ]),
        ),
    )
    client = TestClient(app)
    data = client.get('/api/matchups/today').json()
    assert data[0]['injury_status'] == 'Out'


def test_game_date_reflects_explicit_date_param(mock_services, monkeypatch):
    svc, _ = mock_services
    svc.get_upcoming_game_dates = AsyncMock(return_value=['2026-01-16'])
    monkeypatch.setattr(
        'app.routes.matchups.DBService',
        lambda: MagicMock(get_recent_game_dates=AsyncMock(return_value=[]), load_all_injury_statuses=AsyncMock(return_value=[])),
    )
    client = TestClient(app)
    data = client.get('/api/matchups/today?date=20260116').json()
    assert data[0]['game_date'] == '2026-01-16'


def test_game_date_is_null_when_no_upcoming_slate(mock_services):
    svc, _ = mock_services
    svc.get_schedule_date = MagicMock(return_value=None)
    svc.get_games_today = AsyncMock(return_value={})
    client = TestClient(app)
    resp = client.get('/api/matchups/today')
    assert resp.status_code == 200
    assert resp.json() == []


def test_current_slate_date_reflects_resolved_date(mock_services):
    """Must be independent of /today's player list -- the label needs a
    correct answer even when zero players end up matched for a real slate."""
    client = TestClient(app)
    resp = client.get('/api/matchups/current-slate-date')
    assert resp.status_code == 200
    assert resp.json() == '2026-01-15'


def test_current_slate_date_is_null_in_offseason(mock_services):
    svc, _ = mock_services
    svc.get_schedule_date = MagicMock(return_value=None)
    client = TestClient(app)
    resp = client.get('/api/matchups/current-slate-date')
    assert resp.status_code == 200
    assert resp.json() is None


def test_current_slate_date_null_even_with_no_matched_players(mock_services):
    """The resolved date must not depend on whether any player happened to
    match -- a real slate can exist with zero matched fantasy-relevant
    players (edge case), and the picker still needs the correct date."""
    svc, _ = mock_services
    svc.get_schedule_date = MagicMock(return_value='2026-02-20')
    svc.get_games_today = AsyncMock(return_value={})  # no games matched to any player
    client = TestClient(app)
    resp = client.get('/api/matchups/current-slate-date')
    assert resp.status_code == 200
    assert resp.json() == '2026-02-20'


def test_returns_empty_on_no_games(mock_services):
    svc, provider = mock_services
    svc.get_games_today = AsyncMock(return_value={})
    client = TestClient(app)
    resp = client.get('/api/matchups/today')
    assert resp.status_code == 200
    assert resp.json() == []


def test_returns_empty_on_service_error(mock_services):
    svc, _ = mock_services
    svc.get_games_today = AsyncMock(side_effect=Exception('data source down'))
    client = TestClient(app)
    resp = client.get('/api/matchups/today')
    assert resp.status_code == 200
    assert resp.json() == []


def test_rejects_malformed_date(mock_services):
    client = TestClient(app)
    resp = client.get('/api/matchups/today?date=2026-01-15')  # dashes, not YYYYMMDD
    assert resp.status_code == 422


def test_rejects_date_outside_known_slates(mock_services, monkeypatch):
    svc, _ = mock_services
    svc.get_upcoming_game_dates = AsyncMock(return_value=['2026-01-16'])
    monkeypatch.setattr(
        'app.routes.matchups.DBService',
        lambda: MagicMock(get_recent_game_dates=AsyncMock(return_value=[]), load_all_injury_statuses=AsyncMock(return_value=[])),
    )
    client = TestClient(app)
    resp = client.get('/api/matchups/today?date=20990101')
    assert resp.status_code == 404


def test_accepts_upcoming_date_in_whitelist(mock_services, monkeypatch):
    svc, _ = mock_services
    svc.get_upcoming_game_dates = AsyncMock(return_value=['2026-01-16'])
    monkeypatch.setattr(
        'app.routes.matchups.DBService',
        lambda: MagicMock(get_recent_game_dates=AsyncMock(return_value=[]), load_all_injury_statuses=AsyncMock(return_value=[])),
    )
    client = TestClient(app)
    resp = client.get('/api/matchups/today?date=20260116')
    assert resp.status_code == 200


def test_clear_matchup_response_cache_empties_dict(monkeypatch):
    import app.routes.matchups as matchups_module
    monkeypatch.setattr(matchups_module, '_response_cache', {'today': (0.0, [])})
    matchups_module.clear_matchup_response_cache()
    assert matchups_module._response_cache == {}

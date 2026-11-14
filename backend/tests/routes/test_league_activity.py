from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

from app.exceptions import DataSourceError
from app.models.activity_models import ActivityMove, ActivityPlayer, ActivityTeam, LeagueActivity
from app.utils.http_cache import CACHE_RULES


def activity(n_moves: int = 3) -> LeagueActivity:
    return LeagueActivity(
        season_id=2026,
        season_over=False,
        categories=['PTS'],
        teams=[ActivityTeam(team_id=1, name='Team Alpha', abbrev='ALP')],
        moves=[
            ActivityMove(id=f'm{i}', kind='add', at=datetime(2026, 1, 1, tzinfo=timezone.utc), team_id=1,
                         added=[ActivityPlayer(player_id=i, name=f'Player {i}')], dropped=[])
            for i in range(n_moves)
        ],
        trades=[],
        released=[],
        last_updated=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )


def mock_service(result=None, error=None):
    service = AsyncMock()
    service.get_activity.side_effect = error
    service.get_activity.return_value = result
    return patch('app.routes.league.get_league_activity_service', return_value=service)


def test_activity(test_client):
    with mock_service(activity()):
        response = test_client.get('/api/league/activity')
    assert response.status_code == 200
    data = response.json()
    assert LeagueActivity(**data).season_id == 2026
    assert [m['id'] for m in data['moves']] == ['m0', 'm1', 'm2']
    assert response.headers['cache-control'] == CACHE_RULES['/api/league/activity']


def test_activity_espn_down(test_client):
    with mock_service(error=DataSourceError('Error fetching league activity from ESPN API')):
        response = test_client.get('/api/league/activity')
    assert response.status_code == 503


def test_latest_moves_limit(test_client):
    with mock_service(activity(20)):
        response = test_client.get('/api/league/activity/latest?limit=5')
    assert response.status_code == 200
    data = response.json()
    assert [m['id'] for m in data['moves']] == ['m0', 'm1', 'm2', 'm3', 'm4']
    assert data['teams'][0]['abbrev'] == 'ALP'


def test_latest_moves_rejects_bad_limit(test_client):
    with mock_service(activity()):
        assert test_client.get('/api/league/activity/latest?limit=0').status_code == 422


def test_player_history(test_client):
    from app.models.activity_models import PlayerHistoryMove, PlayerHistoryStint, PlayerLeagueHistory
    at = datetime(2026, 10, 15, tzinfo=timezone.utc)
    history = PlayerLeagueHistory(
        season_id=2027, player_id=7,
        teams=[ActivityTeam(team_id=1, name='Team Alpha', abbrev='ALP')],
        moves=[PlayerHistoryMove(id='d', kind='draft', at=at, team_id=1, pick=3, round=1)],
        stints=[PlayerHistoryStint(team_id=1, start=at)],
        last_updated=at,
    )
    service = AsyncMock()
    service.get_player_history.return_value = history
    with patch('app.routes.league.get_league_activity_service', return_value=service):
        response = test_client.get('/api/league/players/7/history')
    assert response.status_code == 200
    service.get_player_history.assert_awaited_once_with(7)
    data = response.json()
    assert data['moves'][0]['kind'] == 'draft' and data['stints'][0]['end'] is None


def test_player_history_espn_down(test_client):
    service = AsyncMock()
    service.get_player_history.side_effect = DataSourceError('ESPN down')
    with patch('app.routes.league.get_league_activity_service', return_value=service):
        response = test_client.get('/api/league/players/7/history')
    assert response.status_code == 503

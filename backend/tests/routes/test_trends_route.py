from unittest.mock import AsyncMock, MagicMock

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.trend_models import (
    GameLogEntry,
    GameLogResponse,
    MinutesMoverItem,
    MinutesResponse,
    RegressionPlayerGroup,
    RegressionResponse,
    RegressionStatItem,
    UsageResponse,
    UsageRoleItem,
)

_MOCK_PLAYERS = pd.DataFrame([
    {'Name': 'Klay Thompson', 'Pro Team': 'DAL', 'Positions': 'SG', 'status': 'FREEAGENT', 'fantasy_team_name': None},
])

_MOCK_RESPONSE = RegressionResponse(
    items=[
        RegressionPlayerGroup(
            player_id=202691, player_name='Klay Thompson', pro_team='DAL', position='SG', fantasy_status='FA',
            games_last_15d=6,
            stats=[RegressionStatItem(
                stat='3P%', current_pct=33.1, baseline_pct=41.2, dev=-8.1,
                attempts_per_game=8.4, drift_score=0.68,
            )],
        ),
    ],
    window_days=15,
    baseline_seasons=2,
    mode='season',
    last_updated='2026-07-18T12:00:00',
)


_MOCK_MINUTES_RESPONSE = MinutesResponse(
    items=[
        MinutesMoverItem(
            player_id=1630245, player_name='Ayo Dosunmu', pro_team='CHI', position='PG', fantasy_status='FA',
            games_last_15d=7, season_mpg=24.1, l5_mpg=31.8, delta_mpg=7.7,
            season_gp=48, window_gp=5, low_sample=False,
        ),
    ],
    window_days=15,
    last_updated='2026-07-18T12:00:00',
)


_MOCK_USAGE_RESPONSE = UsageResponse(
    items=[
        UsageRoleItem(
            player_id=1630245, player_name='Ayo Dosunmu', pro_team='CHI', position='PG', fantasy_status='FA',
            games_last_15d=7, season_usg=18.2, l5_usg=24.6, delta_usg=6.4,
            season_mpg=24.1, l5_mpg=31.8, delta_mpg=7.7,
            season_gp=48, window_gp=5, role_badge='Role ↑',
        ),
    ],
    window_days=15,
    last_updated='2026-07-18T12:00:00',
)


_MOCK_GAME_LOG = GameLogResponse(
    player_id=1630245, player_name='Ayo Dosunmu', season='2025-26',
    window_days=15, window_start='2026-07-03', season_gp=2,
    season_mpg=28.0, season_usg=21.4,
    season_pct={'3P%': 35.0, 'FT%': 80.0, 'FG%': 47.0},
    baseline_pct={'3P%': 38.0, 'FT%': 78.0, 'FG%': 49.0},
    league_pct={'3P%': 36.0, 'FT%': 78.5, 'FG%': 47.0},
    baseline_seasons=2,
    games=[
        GameLogEntry(game_date='2026-07-10', matchup='CHI vs. MIL', min=30.0, usg=22.5,
                     fgm=7, fga=14, ftm=2, fta=2, fg3m=2, fg3a=5),
        GameLogEntry(game_date='2026-07-12', matchup='CHI @ DET', min=26.0, usg=20.3,
                     fgm=5, fga=12, ftm=4, fta=6, fg3m=1, fg3a=4),
    ],
)


@pytest.fixture
def mock_services(monkeypatch):
    svc = MagicMock()
    svc.get_shooting_regression = AsyncMock(return_value=_MOCK_RESPONSE)
    svc.get_minutes_movers = AsyncMock(return_value=_MOCK_MINUTES_RESPONSE)
    svc.get_usage_role = AsyncMock(return_value=_MOCK_USAGE_RESPONSE)
    svc.get_player_game_log = AsyncMock(return_value=_MOCK_GAME_LOG)

    provider = MagicMock()
    provider.get_players_df = AsyncMock(return_value=_MOCK_PLAYERS)

    monkeypatch.setattr('app.routes.trends._trend_service', svc)
    monkeypatch.setattr('app.routes.trends._data_provider', provider)
    return svc, provider


def test_get_regression_returns_response(mock_services):
    client = TestClient(app)
    resp = client.get('/api/trends/regression')

    assert resp.status_code == 200
    data = resp.json()
    assert len(data['items']) == 1
    group = data['items'][0]
    assert group['player_name'] == 'Klay Thompson'
    assert group['fantasy_status'] == 'FA'
    assert group['stats'][0]['stat'] == '3P%'


def test_get_regression_passes_players_df_to_service(mock_services):
    svc, provider = mock_services
    client = TestClient(app)
    client.get('/api/trends/regression')

    provider.get_players_df.assert_awaited_once()
    svc.get_shooting_regression.assert_awaited_once()
    called_df = svc.get_shooting_regression.call_args.args[0]
    assert called_df.equals(_MOCK_PLAYERS)


def test_get_minutes_returns_response(mock_services):
    client = TestClient(app)
    resp = client.get('/api/trends/minutes')

    assert resp.status_code == 200
    data = resp.json()
    assert len(data['items']) == 1
    item = data['items'][0]
    assert item['player_name'] == 'Ayo Dosunmu'
    assert item['delta_mpg'] == pytest.approx(7.7)


def test_get_minutes_passes_players_df_to_service(mock_services):
    svc, provider = mock_services
    client = TestClient(app)
    client.get('/api/trends/minutes')

    svc.get_minutes_movers.assert_awaited_once()
    called_df = svc.get_minutes_movers.call_args.args[0]
    assert called_df.equals(_MOCK_PLAYERS)


def test_get_usage_returns_response(mock_services):
    client = TestClient(app)
    resp = client.get('/api/trends/usage')

    assert resp.status_code == 200
    data = resp.json()
    assert len(data['items']) == 1
    item = data['items'][0]
    assert item['player_name'] == 'Ayo Dosunmu'
    assert item['role_badge'] == 'Role ↑'


def test_get_usage_passes_players_df_to_service(mock_services):
    svc, provider = mock_services
    client = TestClient(app)
    client.get('/api/trends/usage')

    svc.get_usage_role.assert_awaited_once()
    called_df = svc.get_usage_role.call_args.args[0]
    assert called_df.equals(_MOCK_PLAYERS)


def test_get_regression_passes_baseline_seasons(mock_services):
    svc, _ = mock_services
    client = TestClient(app)
    client.get('/api/trends/regression?baseline_seasons=1')

    assert svc.get_shooting_regression.call_args.args[2] == 1


def test_get_regression_defaults_to_two_baseline_seasons(mock_services):
    svc, _ = mock_services
    client = TestClient(app)
    client.get('/api/trends/regression')

    assert svc.get_shooting_regression.call_args.args[2] == 2


def test_get_regression_defaults_to_season_mode(mock_services):
    svc, _ = mock_services
    client = TestClient(app)
    client.get('/api/trends/regression')

    assert svc.get_shooting_regression.call_args.args[3] == 'season'


def test_get_regression_passes_form_mode(mock_services):
    svc, _ = mock_services
    client = TestClient(app)
    client.get('/api/trends/regression?mode=form')

    assert svc.get_shooting_regression.call_args.args[3] == 'form'


def test_get_regression_rejects_unknown_mode(mock_services):
    client = TestClient(app)
    assert client.get('/api/trends/regression?mode=vibes').status_code == 422


def test_get_game_log_returns_response(mock_services):
    client = TestClient(app)
    resp = client.get('/api/trends/player/1630245/gamelog')

    assert resp.status_code == 200
    data = resp.json()
    assert data['player_name'] == 'Ayo Dosunmu'
    assert len(data['games']) == 2
    assert data['games'][0]['usg'] == pytest.approx(22.5)
    assert data['baseline_pct']['3P%'] == pytest.approx(38.0)


def test_get_game_log_passes_params_to_service(mock_services):
    svc, _ = mock_services
    client = TestClient(app)
    client.get('/api/trends/player/1630245/gamelog?window_days=30&baseline_seasons=1')

    svc.get_player_game_log.assert_awaited_once_with(1630245, 30, 1, 'season')


def test_get_game_log_404_when_no_rows(mock_services):
    svc, _ = mock_services
    svc.get_player_game_log = AsyncMock(return_value=None)
    client = TestClient(app)
    resp = client.get('/api/trends/player/999/gamelog')

    assert resp.status_code == 404

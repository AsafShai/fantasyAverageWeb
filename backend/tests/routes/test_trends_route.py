from unittest.mock import AsyncMock, MagicMock

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.trend_models import (
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
            player_name='Klay Thompson', pro_team='DAL', position='SG', fantasy_status='FA',
            games_last_15d=6,
            stats=[RegressionStatItem(
                stat='3P%', current_pct=33.1, baseline_pct=41.2, dev=-8.1,
                attempts_per_game=8.4, drift_score=0.68,
            )],
        ),
    ],
    window_days=15,
    last_updated='2026-07-18T12:00:00',
)


_MOCK_MINUTES_RESPONSE = MinutesResponse(
    items=[
        MinutesMoverItem(
            player_name='Ayo Dosunmu', pro_team='CHI', position='PG', fantasy_status='FA',
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
            player_name='Ayo Dosunmu', pro_team='CHI', position='PG', fantasy_status='FA',
            games_last_15d=7, season_usg=18.2, l5_usg=24.6, delta_usg=6.4,
            season_mpg=24.1, l5_mpg=31.8, delta_mpg=7.7,
            season_gp=48, window_gp=5, role_badge='Role ↑',
        ),
    ],
    window_days=15,
    last_updated='2026-07-18T12:00:00',
)


@pytest.fixture
def mock_services(monkeypatch):
    svc = MagicMock()
    svc.get_shooting_regression = AsyncMock(return_value=_MOCK_RESPONSE)
    svc.get_minutes_movers = AsyncMock(return_value=_MOCK_MINUTES_RESPONSE)
    svc.get_usage_role = AsyncMock(return_value=_MOCK_USAGE_RESPONSE)

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

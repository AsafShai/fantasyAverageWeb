from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.main import app
from app.services import model_accuracy_service

client = TestClient(app)


def test_summary_route_validates_mode_and_window():
    assert client.get('/api/model-accuracy/summary?mode=bogus').status_code == 422
    assert client.get('/api/model-accuracy/summary?window=year').status_code == 422


def test_summary_route_passes_params_through():
    payload = {
        'mode': 'retro', 'window': 'd30', 'start': '2026-11-11', 'end': '2026-12-10',
        'games': 3, 'dnp': 0, 'minutes': None, 'first_snapshot_date': None,
        'categories': [{'key': 'pts', 'label': 'PTS', 'band': 4, 'model_mae': 3.9,
                        'baseline_mae': 4.4, 'hit_rate': 0.7, 'games': 3}],
    }
    with patch.object(model_accuracy_service, 'summary', AsyncMock(return_value=payload)) as summary:
        resp = client.get('/api/model-accuracy/summary?mode=retro&window=d30')
    assert resp.status_code == 200
    summary.assert_awaited_once_with('retro', 'd30')
    assert resp.json()['categories'][0]['baseline_mae'] == 4.4


def test_player_route_404_without_graded_games():
    with patch.object(model_accuracy_service, 'player', AsyncMock(return_value=None)):
        resp = client.get('/api/model-accuracy/player/123')
    assert resp.status_code == 404


def test_misses_route_parses_week():
    from datetime import date

    with patch.object(model_accuracy_service, 'misses', AsyncMock(return_value={'week_start': '2026-12-07', 'misses': []})) as misses:
        resp = client.get('/api/model-accuracy/misses?week=2026-12-09')
    assert resp.status_code == 200
    misses.assert_awaited_once_with(date(2026, 12, 9))

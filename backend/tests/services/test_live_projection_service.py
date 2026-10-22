import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import pytest

from app.services.live_projection_service import LiveProjectionService
from app.services.nba_matchup_service import GameInfo


@pytest.mark.asyncio
async def test_unmatched_players_are_logged_once_per_slate(caplog):
    service = LiveProjectionService()
    players_df = pd.DataFrame([
        {'Name': 'Aday Mara', 'Pro Team': 'LAL'},
        {'Name': 'Tacko Fall', 'Pro Team': 'LAL'},
        {'Name': 'No Game', 'Pro Team': 'BOS'},
    ])
    games = {'LAL': GameInfo(opponent='GSW', is_home=True)}

    with (
        patch.object(service, '_ensure_inference', AsyncMock(return_value=MagicMock())),
        patch.object(service, '_name_index', {}),
        caplog.at_level(logging.WARNING, logger='app.services.live_projection_service'),
    ):
        assert await service.project_today(players_df, games) == {}

    warnings = [r.getMessage() for r in caplog.records if 'feature-store match' in r.getMessage()]
    assert warnings == [
        'No feature-store match for 2 player(s) with a game today, skipped: Aday Mara, Tacko Fall'
    ]


@pytest.mark.asyncio
async def test_warm_loads_models_and_never_raises():
    service = LiveProjectionService()

    ensure = AsyncMock(return_value=MagicMock())
    with patch.object(service, '_ensure_inference', ensure):
        await service.warm()
    ensure.assert_awaited_once()

    # Runs as a background task at startup; the projection request that needs
    # the models retries and reports the failure itself.
    with patch.object(service, '_ensure_inference', AsyncMock(side_effect=RuntimeError('db down'))):
        await service.warm()


def _fake_inference(player_minutes: dict[int, float]):
    from model_stats_inference.serving.inference import PredictionResult, StatPrediction

    inference = MagicMock()
    inference.store.player_meta.side_effect = lambda pid: {
        'MIN_LAST5_ALL': player_minutes[pid], 'last_game_date': pd.Timestamp.now().normalize(),
    }
    inference.store.player_features.return_value = {}
    inference.predict_many.side_effect = lambda reqs: (
        [PredictionResult(player_id=r.player_id, minutes=r.minutes,
                          stats={'PTS': StatPrediction(value=r.minutes / 2)}) for r in reqs],
        [None] * len(reqs),
    )
    return inference


@pytest.mark.asyncio
async def test_project_today_reuses_predictions_for_an_unchanged_slate():
    service = LiveProjectionService()
    players_df = pd.DataFrame([
        {'Name': 'Player A', 'Pro Team': 'LAL'},
        {'Name': 'Player B', 'Pro Team': 'BOS'},
    ])
    games = {'LAL': GameInfo(opponent='BOS', is_home=True), 'BOS': GameInfo(opponent='LAL', is_home=False)}
    minutes = {1: 30.0, 2: 20.0}
    inference = _fake_inference(minutes)

    with (
        patch.object(service, '_ensure_inference', AsyncMock(return_value=inference)),
        patch.object(service, '_inference', inference),
        patch.object(service, '_name_index', {'playera': 1, 'playerb': 2}),
        patch.object(service, '_slate_projections', {}),
    ):
        first = await service.project_today(players_df, games)
        second = await service.project_today(players_df, games)
        assert second == first
        assert inference.predict_many.call_count == 1
        assert first['Player A']['stats']['pts'] == 15.0

        # A changed input (here the default minutes) predicts again.
        minutes[1] = 36.0
        third = await service.project_today(players_df, games)
        assert inference.predict_many.call_count == 2
        assert third['Player A']['stats']['pts'] == 18.0

        # So does a smaller slate.
        await service.project_today(players_df.iloc[:1], games)
        assert inference.predict_many.call_count == 3


@pytest.mark.asyncio
async def test_project_today_does_not_reuse_predictions_across_stores():
    service = LiveProjectionService()
    players_df = pd.DataFrame([{'Name': 'Player A', 'Pro Team': 'LAL'}])
    games = {'LAL': GameInfo(opponent='BOS', is_home=True)}
    old, new = _fake_inference({1: 30.0}), _fake_inference({1: 30.0})

    with (
        patch.object(service, '_name_index', {'playera': 1}),
        patch.object(service, '_slate_projections', {}),
    ):
        with patch.object(service, '_ensure_inference', AsyncMock(return_value=old)), \
                patch.object(service, '_inference', old):
            await service.project_today(players_df, games)
        with patch.object(service, '_ensure_inference', AsyncMock(return_value=new)), \
                patch.object(service, '_inference', new):
            await service.project_today(players_df, games)
    assert old.predict_many.call_count == 1
    assert new.predict_many.call_count == 1

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

from unittest.mock import AsyncMock, MagicMock

import pandas as pd
import pytest

import app.services.team_slot_pace as team_slot_pace_module
from app.services.team_slot_pace import get_team_slot_pace_df


@pytest.fixture
def mock_data_provider(monkeypatch):
    provider = MagicMock()
    provider.get_slot_usage = AsyncMock(return_value={
        1: {'PG': 10, 'SG': 5, 'UTIL': 3},
        2: {'PG': 8},
    })
    provider.get_totals_df = AsyncMock(return_value=pd.DataFrame({
        'team_id': [1, 2], 'team_name': ['Team Alpha', 'Team Beta'],
    }))
    monkeypatch.setattr(team_slot_pace_module, 'DataProvider', lambda: provider)
    return provider


@pytest.fixture
def mock_nba_service(monkeypatch):
    service = MagicMock()
    service.get_nba_average_pace = AsyncMock(return_value=99.5)
    service.get_nba_game_days_remaining = AsyncMock(return_value=42)
    service.close = AsyncMock()
    monkeypatch.setattr(team_slot_pace_module, 'NBAStatsService', lambda: service)
    return service


@pytest.mark.asyncio
async def test_get_team_slot_pace_df_does_not_close_shared_nba_service(mock_data_provider, mock_nba_service):
    """NBAStatsService is a shared singleton closed once at app shutdown —
    this caller must not close it, since a concurrent caller (e.g.
    estimator_service's own pace fetch, run via the same asyncio.gather) may
    still be using its httpx client. Regression test for that race condition."""
    await get_team_slot_pace_df()

    mock_nba_service.close.assert_not_called()


@pytest.mark.asyncio
async def test_get_team_slot_pace_df_builds_rows_per_team(mock_data_provider, mock_nba_service):
    df = await get_team_slot_pace_df()

    assert set(df['team_id']) == {1, 2}
    row1 = df[df['team_id'] == 1].iloc[0]
    assert row1['team_name'] == 'Team Alpha'
    assert row1['PG'] == 10
    assert row1['SG'] == 5
    assert row1['C'] == 0  # slot with no usage defaults to 0
    assert row1['nba_avg_pace'] == 99.5
    assert row1['nba_game_days_remaining'] == 42


@pytest.mark.asyncio
async def test_get_team_slot_pace_df_falls_back_when_pace_unavailable(mock_data_provider, mock_nba_service):
    """When NBA pace can't be fetched (e.g. ESPN calendar unreachable), fall
    back to the known league-average constant rather than propagating None."""
    mock_nba_service.get_nba_average_pace = AsyncMock(return_value=None)

    df = await get_team_slot_pace_df()

    assert (df['nba_avg_pace'] == 65.9).all()


@pytest.mark.asyncio
async def test_get_team_slot_pace_df_unknown_team_id_gets_placeholder_name(mock_data_provider, mock_nba_service):
    """A team present in slot usage but missing from totals_df (e.g. a
    just-created fantasy team not yet reflected in ESPN standings) still
    gets a row instead of crashing on the team_name lookup."""
    mock_data_provider.get_slot_usage = AsyncMock(return_value={99: {'PG': 1}})

    df = await get_team_slot_pace_df()

    assert df.iloc[0]['team_name'] == 'Team 99'

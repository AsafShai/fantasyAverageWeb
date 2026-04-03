import pandas as pd
import pytest
from unittest.mock import AsyncMock, MagicMock

from app.exceptions import ResourceNotFoundError
from app.services.player_service import PlayerService
from app.models import PaginatedPlayers, Player, PlayerStats, StatTimePeriod


def _sample_player(name: str = "P1") -> Player:
    return Player(
        player_name=name,
        pro_team="T",
        positions=["PG"],
        stats=PlayerStats(
            pts=1,
            reb=1,
            ast=1,
            stl=1,
            blk=1,
            fgm=1,
            fga=1,
            ftm=1,
            fta=1,
            fg_percentage=0.5,
            ft_percentage=0.5,
            three_pm=1,
            minutes=1,
            gp=82,
        ),
        team_id=1,
        status="Active",
        injured=False,
    )


@pytest.fixture
def player_service():
    svc = object.__new__(PlayerService)
    svc.data_provider = MagicMock()
    svc.response_builder = MagicMock()
    svc.logger = MagicMock()
    return svc


@pytest.mark.asyncio
async def test_get_all_players_success(player_service, sample_stats_calculator_averages_df):
    player_service.data_provider.get_players_df = AsyncMock(return_value=sample_stats_calculator_averages_df)
    mock_players = [_sample_player("A")]
    player_service.response_builder.build_all_players_response.return_value = mock_players

    result = await player_service.get_all_players(page=1, limit=10, time_period=StatTimePeriod.SEASON)

    assert isinstance(result, PaginatedPlayers)
    assert result.players == mock_players
    assert result.total_count == 3
    assert result.page == 1
    assert result.limit == 10
    assert result.has_more is False


@pytest.mark.asyncio
async def test_get_all_players_has_more_second_page(player_service, sample_stats_calculator_averages_df):
    player_service.data_provider.get_players_df = AsyncMock(return_value=sample_stats_calculator_averages_df)
    player_service.response_builder.build_all_players_response.side_effect = (
        lambda df: [_sample_player(f"P{i}") for i in range(len(df))]
    )

    result = await player_service.get_all_players(page=1, limit=2, time_period=StatTimePeriod.SEASON)
    assert result.has_more is True
    assert len(result.players) == 2

    page2 = await player_service.get_all_players(page=2, limit=2, time_period=StatTimePeriod.SEASON)
    assert len(page2.players) == 1
    assert page2.has_more is False


@pytest.mark.asyncio
async def test_get_all_players_none_df_raises(player_service):
    player_service.data_provider.get_players_df = AsyncMock(return_value=None)
    with pytest.raises(ResourceNotFoundError, match="No players found"):
        await player_service.get_all_players()


@pytest.mark.asyncio
async def test_get_all_players_empty_df_raises(player_service):
    player_service.data_provider.get_players_df = AsyncMock(return_value=pd.DataFrame())
    with pytest.raises(ResourceNotFoundError, match="No players found"):
        await player_service.get_all_players()

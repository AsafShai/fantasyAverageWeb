import pandas as pd
import pytest
from unittest.mock import AsyncMock, MagicMock

from app.exceptions import ResourceNotFoundError
from app.services.player_rankings_service import PlayerRankingsService
from app.models import Player, PlayerStats


def _sample_player(name: str = "P1") -> Player:
    return Player(
        player_name=name,
        pro_team="LAL",
        positions=["PG"],
        stats=PlayerStats(
            pts=20, reb=5, ast=5, stl=1, blk=0.5,
            fgm=8, fga=17, ftm=4, fta=5,
            fg_percentage=0.47, ft_percentage=0.85,
            three_pm=2, minutes=30, gp=70,
        ),
        team_id=1,
        status="ONTEAM",
        injured=False,
    )


@pytest.fixture
def player_rankings_service():
    svc = object.__new__(PlayerRankingsService)
    svc.data_provider = MagicMock()
    svc.response_builder = MagicMock()
    svc.logger = MagicMock()
    return svc


@pytest.mark.asyncio
async def test_get_player_rankings_returns_players(player_rankings_service, sample_stats_calculator_averages_df):
    player_rankings_service.data_provider.get_players_df = AsyncMock(return_value=sample_stats_calculator_averages_df)
    mock_players = [_sample_player("A"), _sample_player("B")]
    player_rankings_service.response_builder.build_all_players_response.return_value = mock_players

    result = await player_rankings_service.get_player_rankings()

    assert result == mock_players
    player_rankings_service.data_provider.get_players_df.assert_called_once_with(0)


@pytest.mark.asyncio
async def test_get_player_rankings_none_df_raises(player_rankings_service):
    player_rankings_service.data_provider.get_players_df = AsyncMock(return_value=None)
    with pytest.raises(ResourceNotFoundError, match="No players found"):
        await player_rankings_service.get_player_rankings()


@pytest.mark.asyncio
async def test_get_player_rankings_empty_df_raises(player_rankings_service):
    player_rankings_service.data_provider.get_players_df = AsyncMock(return_value=pd.DataFrame())
    with pytest.raises(ResourceNotFoundError, match="No players found"):
        await player_rankings_service.get_player_rankings()

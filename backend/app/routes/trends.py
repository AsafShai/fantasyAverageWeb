from fastapi import APIRouter, HTTPException

from app.models.trend_models import GameLogResponse, MinutesResponse, RegressionResponse, UsageResponse
from app.services.data_provider import DataProvider
from app.services.trend_service import (
    DEFAULT_BASELINE_SEASONS,
    DEFAULT_RECENCY_WINDOW_DAYS,
    TrendService,
)

router = APIRouter()

_trend_service = TrendService()
_data_provider = DataProvider()


@router.get('/regression', response_model=RegressionResponse)
async def get_shooting_regression(
    window_days: int = DEFAULT_RECENCY_WINDOW_DAYS,
    baseline_seasons: int = DEFAULT_BASELINE_SEASONS,
) -> RegressionResponse:
    players_df = await _data_provider.get_players_df()
    return await _trend_service.get_shooting_regression(players_df, window_days, baseline_seasons)


@router.get('/minutes', response_model=MinutesResponse)
async def get_minutes_movers(window_days: int = DEFAULT_RECENCY_WINDOW_DAYS) -> MinutesResponse:
    players_df = await _data_provider.get_players_df()
    return await _trend_service.get_minutes_movers(players_df, window_days)


@router.get('/usage', response_model=UsageResponse)
async def get_usage_role(window_days: int = DEFAULT_RECENCY_WINDOW_DAYS) -> UsageResponse:
    players_df = await _data_provider.get_players_df()
    return await _trend_service.get_usage_role(players_df, window_days)


@router.get('/player/{player_id}/gamelog', response_model=GameLogResponse)
async def get_player_game_log(
    player_id: int,
    window_days: int = DEFAULT_RECENCY_WINDOW_DAYS,
    baseline_seasons: int = DEFAULT_BASELINE_SEASONS,
) -> GameLogResponse:
    response = await _trend_service.get_player_game_log(player_id, window_days, baseline_seasons)
    if response is None:
        raise HTTPException(status_code=404, detail=f'No game log for player {player_id} this season')
    return response

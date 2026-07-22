from fastapi import APIRouter

from app.models.trend_models import MinutesResponse, RegressionResponse, UsageResponse
from app.services.data_provider import DataProvider
from app.services.trend_service import DEFAULT_RECENCY_WINDOW_DAYS, TrendService

router = APIRouter()

_trend_service = TrendService()
_data_provider = DataProvider()


@router.get('/regression', response_model=RegressionResponse)
async def get_shooting_regression(window_days: int = DEFAULT_RECENCY_WINDOW_DAYS) -> RegressionResponse:
    players_df = await _data_provider.get_players_df()
    return await _trend_service.get_shooting_regression(players_df, window_days)


@router.get('/minutes', response_model=MinutesResponse)
async def get_minutes_movers(window_days: int = DEFAULT_RECENCY_WINDOW_DAYS) -> MinutesResponse:
    players_df = await _data_provider.get_players_df()
    return await _trend_service.get_minutes_movers(players_df, window_days)


@router.get('/usage', response_model=UsageResponse)
async def get_usage_role(window_days: int = DEFAULT_RECENCY_WINDOW_DAYS) -> UsageResponse:
    players_df = await _data_provider.get_players_df()
    return await _trend_service.get_usage_role(players_df, window_days)

import logging

from fastapi import APIRouter, HTTPException

from app.models.projection_models import (
    PlayerNextGameProjection,
    PredictProjectionRequest,
    PredictProjectionResponse,
)
from app.services.live_projection_service import LiveProjectionService
from app.services.player_next_game_service import PlayerNextGameService

router = APIRouter()
logger = logging.getLogger(__name__)

_projection_service = LiveProjectionService()
_next_game_service = PlayerNextGameService()


@router.get('/player/{player_id}', response_model=PlayerNextGameProjection)
async def player_next_game_projection(player_id: str) -> PlayerNextGameProjection:
    result = await _next_game_service.next_game_projection(player_id)
    if result is None:
        raise HTTPException(status_code=404, detail='no upcoming projection for this player')
    return result


@router.post('/predict', response_model=PredictProjectionResponse)
async def predict_projection(body: PredictProjectionRequest) -> PredictProjectionResponse:
    result = await _projection_service.project_one(
        body.player_name, body.opponent, body.is_home, body.minutes
    )
    if result is None:
        raise HTTPException(status_code=404, detail='no projection available for this player')
    return PredictProjectionResponse(stats=result['stats'])

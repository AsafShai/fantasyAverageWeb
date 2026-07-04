import logging

from fastapi import APIRouter, HTTPException

from app.models.projection_models import PredictProjectionRequest, PredictProjectionResponse
from app.services.live_projection_service import LiveProjectionService

router = APIRouter()
logger = logging.getLogger(__name__)

_projection_service = LiveProjectionService()


@router.post('/predict', response_model=PredictProjectionResponse)
async def predict_projection(body: PredictProjectionRequest) -> PredictProjectionResponse:
    result = await _projection_service.project_one(
        body.player_name, body.opponent, body.is_home, body.minutes
    )
    if result is None:
        raise HTTPException(status_code=404, detail='no projection available for this player')
    return PredictProjectionResponse(stats=result['stats'])

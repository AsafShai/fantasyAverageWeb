from fastapi import APIRouter, HTTPException, Depends, Query
from typing import List, Annotated
from app.models import Player, StatTimePeriod
from app.exceptions import ResourceNotFoundError
from app.services.player_rankings_service import PlayerRankingsService
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

PlayerRankingsServiceDep = Annotated[PlayerRankingsService, Depends(PlayerRankingsService)]


@router.get("/", response_model=List[Player])
async def get_player_rankings(
    service: PlayerRankingsServiceDep,
    period: StatTimePeriod = Query(default=StatTimePeriod.SEASON),
):
    try:
        return await service.get_player_rankings(period)
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error getting player rankings: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve player rankings")

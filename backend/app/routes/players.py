from fastapi import APIRouter, HTTPException, Depends, Query
from app.models import PaginatedPlayers, StatTimePeriod
from app.exceptions import ResourceNotFoundError
from app.services.player_service import PlayerService
from typing import Annotated
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

PlayerServiceDep = Annotated[PlayerService, Depends(PlayerService)]


@router.get("/", response_model=PaginatedPlayers)
async def get_all_players(
    player_service: PlayerServiceDep,
    page: int = Query(1, ge=1, description="Page number"),
    limit: int = Query(500, ge=10, le=500, description="Players per page"),
    time_period: StatTimePeriod = Query(
        StatTimePeriod.SEASON,
        description="Time period for stats: season, last_7, last_15, last_30"
    ),
):
    """Get all players including free agents and waivers with pagination"""
    try:
        return await player_service.get_all_players(page, limit, time_period)
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error getting all players: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve players")

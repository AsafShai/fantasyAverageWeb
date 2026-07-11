from fastapi import APIRouter, HTTPException, Depends, Query
from app.models import PaginatedPlayers, StatTimePeriod
from app.exceptions import ResourceNotFoundError
from app.services.player_service import PlayerService
from typing import Annotated, Optional
from datetime import date
from app.config import settings
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

PlayerServiceDep = Annotated[PlayerService, Depends(PlayerService)]


@router.get("/", response_model=PaginatedPlayers)
async def get_all_players(
    player_service: PlayerServiceDep,
    page: int = Query(1, ge=1, description="Page number"),
    limit: int = Query(500, ge=10, le=1200, description="Players per page"),
    time_period: StatTimePeriod = Query(
        StatTimePeriod.SEASON,
        description="Time period for stats: season, last_7, last_15, last_30, custom"
    ),
    start: Optional[date] = Query(None, description="Start date, required when time_period=custom"),
    end: Optional[date] = Query(None, description="End date, required when time_period=custom"),
):
    """Get all players including free agents and waivers with pagination"""
    try:
        if time_period == StatTimePeriod.CUSTOM:
            if start is None or end is None:
                raise HTTPException(status_code=422, detail="custom time_period requires both start and end")
            if start >= end:
                raise HTTPException(status_code=422, detail="start must be before end")
            if start < settings.season_start:
                raise HTTPException(status_code=422, detail=f"start cannot be before season start ({settings.season_start})")
            if end > date.today():
                raise HTTPException(status_code=422, detail="end cannot be in the future")

        return await player_service.get_all_players(page, limit, time_period, start, end)
    except HTTPException:
        raise
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error getting all players: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve players")

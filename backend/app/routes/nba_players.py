import logging
from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.config import settings
from app.models.nba_player_models import NbaPlayerBio, NbaPlayerStatsResponse
from app.models.player import StatTimePeriod
from app.services.nba_player_service import NbaPlayerService

router = APIRouter()
logger = logging.getLogger(__name__)

_service = NbaPlayerService()


def _validate_custom_range(time_period: StatTimePeriod, start: Optional[date], end: Optional[date]) -> None:
    if time_period != StatTimePeriod.CUSTOM:
        return
    if start is None or end is None:
        raise HTTPException(status_code=422, detail="custom time_period requires both start and end")
    if start >= end:
        raise HTTPException(status_code=422, detail="start must be before end")
    if start < settings.season_start:
        raise HTTPException(
            status_code=422,
            detail=f"start cannot be before season start ({settings.season_start})",
        )
    if end > date.today():
        raise HTTPException(status_code=422, detail="end cannot be in the future")


@router.get("/{player_id}", response_model=NbaPlayerBio)
async def get_nba_player(player_id: str):
    bio = _service.get_bio(player_id)
    if bio is None:
        raise HTTPException(status_code=404, detail=f"Player {player_id} not found")
    return bio


@router.get("/{player_id}/stats", response_model=NbaPlayerStatsResponse)
async def get_nba_player_stats(
    player_id: str,
    time_period: StatTimePeriod = Query(
        StatTimePeriod.SEASON,
        description="Time period for stats: season, last_7, last_15, last_30, custom",
    ),
    start: Optional[date] = Query(None, description="Start date, required when time_period=custom"),
    end: Optional[date] = Query(None, description="End date, required when time_period=custom"),
):
    try:
        _validate_custom_range(time_period, start, end)
        return await _service.get_stats(player_id, time_period, start, end)
    except HTTPException:
        raise
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Player {player_id} not found")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.error("Error getting NBA player stats for %s: %s", player_id, e)
        raise HTTPException(status_code=500, detail="Failed to retrieve player stats")

from fastapi import APIRouter, HTTPException, Depends, Query
from app.models import TeamDetail, TeamPlayers, Team, StatTimePeriod
from app.exceptions import InvalidParameterError, ResourceNotFoundError
from app.services.team_service import TeamService
from typing import Annotated, List, Optional
from datetime import date
from app.config import settings
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

TeamServiceDep = Annotated[TeamService, Depends(TeamService)]


@router.get("/", response_model=List[Team])
async def get_teams_list(
    team_service: TeamServiceDep
):
    """Get list of all teams"""
    try:
        return await team_service.get_teams_list()
    except InvalidParameterError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error getting teams list: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve teams list")


@router.get("/{team_id}", response_model=TeamDetail)
async def get_team_detail(
    team_id: int,
    team_service: TeamServiceDep,
    time_period: StatTimePeriod = Query(
        StatTimePeriod.SEASON,
        description="Time period for player stats: season, last_7, last_15, last_30, custom"
    ),
    start: Optional[date] = Query(None, description="Start date, required when time_period=custom"),
    end: Optional[date] = Query(None, description="End date, required when time_period=custom"),
):
    """Get detailed stats for a specific team"""
    if team_id is None or team_id <= 0:
        raise HTTPException(status_code=400, detail="Team ID must be positive")

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

        return await team_service.get_team_detail(team_id, time_period, start, end)
    except HTTPException:
        raise
    except InvalidParameterError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error getting team stats for {team_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve team statistics")


@router.get("/{team_id}/players", response_model=TeamPlayers)
async def get_team_players(
    team_id: int,
    team_service: TeamServiceDep
):
    """Get list of players for a specific team by team ID"""
    if team_id is None or team_id <= 0:
        raise HTTPException(status_code=400, detail="Team ID must be positive")
    
    try: 
        return await team_service.get_team_players(team_id)
    except InvalidParameterError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error getting players for team ID {team_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve team players")
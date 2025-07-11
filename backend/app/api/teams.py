from fastapi import APIRouter, HTTPException, Depends
from app.models.fantasy import TeamDetail, TeamPlayers
from app.services.team_service import TeamService
from typing import Annotated, List
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

TeamServiceDep = Annotated[TeamService, Depends(TeamService)]


@router.get("/", response_model=List[str])
async def get_teams_list(
    team_service: TeamServiceDep
):
    """Get list of all teams"""
    try:
        return team_service.get_teams_list()
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error getting teams list: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve teams list")


@router.get("/{team_name}", response_model=TeamDetail)
async def get_team_detail(
    team_name: str,
    team_service: TeamServiceDep
):
    """Get detailed stats for a specific team"""
    if not team_name or len(team_name.strip()) == 0:
        raise HTTPException(status_code=400, detail="Team name cannot be empty")
    
    try:
        return team_service.get_team_detail(team_name.strip())
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error getting team stats for {team_name}: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve team statistics")


@router.get("/{team_name}/players", response_model=TeamPlayers)
async def get_team_players(
    team_name: str,
    team_service: TeamServiceDep
):
    """Get list of players for a specific team"""
    if not team_name or len(team_name.strip()) == 0:
        raise HTTPException(status_code=400, detail="Team name cannot be empty")
    list_teams = team_service.get_teams_list()
    if list_teams and team_name.strip() not in list_teams:
        raise HTTPException(status_code=404, detail="Team not found")
    
    try: 
        return team_service.get_team_players(team_name.strip())
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error getting players for team {team_name}: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve team players")
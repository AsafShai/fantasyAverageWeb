from fastapi import APIRouter, HTTPException, Depends
from app.models import LeagueSummary, LeagueShotsData
from app.services.league_service import LeagueService
from typing import Annotated
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

LeagueServiceDep = Annotated[LeagueService, Depends(LeagueService)]


@router.get("/summary", response_model=LeagueSummary)
async def get_league_summary(
    league_service: LeagueServiceDep
):
    """Get league overview and summary statistics"""
    try:
        return league_service.get_league_summary()
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error getting league summary: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve league summary") from e


@router.get("/shots", response_model=LeagueShotsData)
async def get_league_shots(
    league_service: LeagueServiceDep
):
    """Get league-wide shooting statistics"""
    try:
        return league_service.get_league_shots_data()
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error getting league shots data: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve league shots data") from e



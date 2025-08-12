import logging
from fastapi import APIRouter, HTTPException, Depends
from app.models import HeatmapData
from app.services.league_service import LeagueService
from typing import Annotated
from app.exceptions import ResourceNotFoundError

router = APIRouter()
logger = logging.getLogger(__name__)

LeagueServiceDep = Annotated[LeagueService, Depends(LeagueService)]

@router.get("/heatmap", response_model=HeatmapData)
async def get_heatmap(league_service: LeagueServiceDep):
    """Get heatmap data for visualization"""
    try:
        return await league_service.get_heatmap_data()
    except ResourceNotFoundError as e:
        logger.warning(f"Invalid request for heatmap: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error getting heatmap data: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve heatmap data")
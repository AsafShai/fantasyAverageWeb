from fastapi import APIRouter, Query, HTTPException, Depends
from typing import Optional, Annotated
from app.models.fantasy import LeagueRankings
from app.models.requests import SortOrder
from app.services.ranking_service import RankingService
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

RankingServiceDep = Annotated[RankingService, Depends(RankingService)]

@router.get("/rankings", response_model=LeagueRankings)
async def get_rankings(
    ranking_service: RankingServiceDep,
    sort_by: Optional[str] = Query(None, description="Category to sort by"),
    order: SortOrder = Query(SortOrder.DESC, description="Sort order: asc or desc")
):
    """Get league rankings with optional sorting"""
    try:
        return ranking_service.get_rankings(sort_by=sort_by, order=order.value)
    except Exception as e:
        logger.error(f"Error getting rankings: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve rankings")

@router.get("/rankings/category/{category}")
async def get_category_rankings(
    category: str,
    ranking_service: RankingServiceDep
):
    """Get rankings for a specific category"""
    if not category or len(category.strip()) == 0:
        raise HTTPException(status_code=400, detail="Category cannot be empty")
    
    try:
        result = ranking_service.get_category_rankings(category)
        if not result:
            raise HTTPException(status_code=404, detail=f"Category '{category}' not found or no data available")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting category rankings for {category}: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve category rankings")
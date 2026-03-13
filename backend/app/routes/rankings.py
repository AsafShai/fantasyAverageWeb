from fastapi import APIRouter, Query, HTTPException, Depends
from typing import Optional, Annotated
from datetime import date
from app.models import LeagueRankings
from app.exceptions import InvalidParameterError, ResourceNotFoundError
from app.models.requests import SortOrder
from app.services.ranking_service import RankingService
from app.config import settings
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

RankingServiceDep = Annotated[RankingService, Depends(RankingService)]

@router.get("/rankings", response_model=LeagueRankings)
async def get_rankings(
    ranking_service: RankingServiceDep,
    sort_by: Optional[str] = Query(None, description="Category to sort by"),
    order: SortOrder = Query(SortOrder.ASC, description="Sort order: asc or desc"),
    start_date: Optional[date] = Query(None, description="Start date for date range filter"),
    end_date: Optional[date] = Query(None, description="End date for date range filter"),
):
    """Get league rankings with optional sorting and date range filtering"""
    try:
        if (start_date is None) != (end_date is None):
            raise HTTPException(status_code=422, detail="Both start_date and end_date must be provided together")
        if start_date is not None and end_date is not None:
            if start_date >= end_date:
                raise HTTPException(status_code=422, detail="start_date must be before end_date")
            if start_date < settings.season_start:
                raise HTTPException(status_code=422, detail=f"start_date cannot be before season start ({settings.season_start})")
            if end_date > date.today():
                raise HTTPException(status_code=422, detail="end_date cannot be in the future")

        return await ranking_service.get_league_rankings(
            sort_by=sort_by,
            order=order.value,
            start_date=start_date,
            end_date=end_date,
        )
    except HTTPException:
        raise
    except InvalidParameterError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error getting rankings: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to retrieve rankings: {e}")
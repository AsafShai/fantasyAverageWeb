import logging
from fastapi import APIRouter, HTTPException, Depends, Query
from app.models import HeatmapData, RankingsOverTimeResponse, TeamTimeSeriesPoint
from app.services.league_service import LeagueService
from app.services.db_service import DBService
from typing import Annotated, Optional
from app.exceptions import ResourceNotFoundError
from datetime import date, date as date_type
from app.config import settings

router = APIRouter()
logger = logging.getLogger(__name__)

LeagueServiceDep = Annotated[LeagueService, Depends(LeagueService)]
DBServiceDep = Annotated[DBService, Depends(DBService)]

_SOURCE_TO_TABLE = {
    "rankings_avg": "team_rankings_averages",
    "rankings_totals": "team_rankings_totals",
}

@router.get("/heatmap", response_model=HeatmapData)
async def get_heatmap(
    league_service: LeagueServiceDep,
    start_date: Optional[date] = Query(None, description="Start date for date range filter"),
    end_date: Optional[date] = Query(None, description="End date for date range filter"),
):
    """Get heatmap data for visualization"""
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

        return await league_service.get_heatmap_data(start_date=start_date, end_date=end_date)
    except HTTPException:
        raise
    except ResourceNotFoundError as e:
        logger.warning(f"Invalid request for heatmap: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error getting heatmap data: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve heatmap data")

@router.get("/over-time", response_model=RankingsOverTimeResponse)
async def get_over_time(
    db_service: DBServiceDep,
    source: str = Query(default="rankings_avg", pattern="^(rankings_avg|rankings_totals|snapshot|averages)$"),
    team_ids: Optional[str] = Query(default=None, description="Comma-separated team IDs"),
):
    """Get team stats/rankings over time for time-series chart"""
    try:
        parsed_team_ids: Optional[list[int]] = None
        if team_ids:
            try:
                parsed_team_ids = [int(tid.strip()) for tid in team_ids.split(",") if tid.strip()]
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid team_ids format")

        if source == "snapshot":
            rows = await db_service.get_snapshot_over_time(parsed_team_ids)
        elif source == "averages":
            rows = await db_service.get_averages_over_time(parsed_team_ids)
        else:
            table = _SOURCE_TO_TABLE[source]
            rows = await db_service.get_rankings_over_time(table, parsed_team_ids)

        points = [TeamTimeSeriesPoint(**{k: (v.isoformat() if isinstance(v, date_type) else v) for k, v in row.items()}) for row in rows]
        return RankingsOverTimeResponse(data=points)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting over-time data: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve over-time data")
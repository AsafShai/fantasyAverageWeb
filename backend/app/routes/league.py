from fastapi import APIRouter, HTTPException, Depends, Query
from app.models import LeagueSummary, LeagueShotsData, DraftReport, RankChanges, TodayHub
from app.models.activity_models import LeagueActivity, LatestMoves
from app.services.league_service import LeagueService
from app.services.draft_report_service import DraftReportService
from app.services.today_service import TodayService
from app.services.league_activity_service import get_league_activity_service
from app.exceptions import ResourceNotFoundError, DataSourceError
from typing import Annotated
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

LeagueServiceDep = Annotated[LeagueService, Depends(LeagueService)]
DraftReportServiceDep = Annotated[DraftReportService, Depends(DraftReportService)]

# One instance, so the composed-response cache and the matchup service's own
# schedule cache survive across requests.
_today_service = TodayService()


@router.get("/today", response_model=TodayHub)
async def get_today_hub() -> TodayHub:
    """Dashboard hub: rank movers vs yesterday, roster health, tonight's slate.

    Never 503s — every part of the hub is fail-open inside the service."""
    return await _today_service.get_today_hub()


@router.get("/rank-changes", response_model=RankChanges)
async def get_rank_changes(
    mode: Annotated[str, Query(pattern="^(averages|totals)$")] = "averages",
) -> RankChanges:
    """Each team's move since the previous stored scoring period: places,
    roto points per category and in total, and games played."""
    try:
        return await _today_service.get_rank_changes(mode)
    except Exception as e:
        logger.exception(f"Error building rank changes: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve rank changes") from e


@router.get("/summary", response_model=LeagueSummary)
async def get_league_summary(
    league_service: LeagueServiceDep
):
    """Get league overview and summary statistics"""
    try:
        return await league_service.get_league_summary()
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except DataSourceError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.exception(f"Error getting league summary: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve league summary") from e


@router.get("/shots", response_model=LeagueShotsData)
async def get_league_shots(
    league_service: LeagueServiceDep
):
    """Get league-wide shooting statistics"""
    try:
        return await league_service.get_league_shots_data()
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except DataSourceError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.exception(f"Error getting league shots data: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve league shots data") from e


@router.get("/draft-report", response_model=DraftReport)
async def get_draft_report(
    draft_report_service: DraftReportServiceDep
):
    """Get draft picks joined to player and team names for the draft report card"""
    try:
        return await draft_report_service.get_draft_report()
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except DataSourceError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.exception(f"Error getting draft report: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve draft report") from e




@router.get("/activity", response_model=LeagueActivity)
async def get_league_activity() -> LeagueActivity:
    """Every add, drop, waiver claim and trade this season, plus what each side
    of each trade got while the players were on its roster."""
    try:
        return await get_league_activity_service().get_activity()
    except DataSourceError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.exception(f"Error getting league activity: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve league activity") from e


@router.get("/activity/latest", response_model=LatestMoves)
async def get_latest_moves(limit: int = Query(8, ge=1, le=50)) -> LatestMoves:
    """The most recent moves only, for the Today card."""
    try:
        activity = await get_league_activity_service().get_activity()
        return LatestMoves(teams=activity.teams, moves=activity.moves[:limit])
    except DataSourceError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.exception(f"Error getting latest moves: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve latest moves") from e

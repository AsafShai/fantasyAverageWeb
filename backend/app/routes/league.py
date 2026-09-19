from fastapi import APIRouter, HTTPException, Depends
from app.models import LeagueSummary, LeagueShotsData, DraftReport, TodayHub
from app.services.league_service import LeagueService
from app.services.draft_report_service import DraftReportService
from app.services.today_service import TodayService
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
        logger.error(f"Error getting league summary: {e}")
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
        logger.error(f"Error getting league shots data: {e}")
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
        logger.error(f"Error getting draft report: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve draft report") from e



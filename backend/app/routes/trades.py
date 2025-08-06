from fastapi import APIRouter, HTTPException, Request
from app.models import TradeSuggestionsResponse
from app.services.trades_service import TradesService, get_trades_service
from typing import Annotated
from fastapi import Depends
from app.exceptions import ResourceNotFoundError, DataSourceError
from slowapi import Limiter
from slowapi.util import get_remote_address
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

limiter = Limiter(key_func=get_remote_address)

TradeServiceDep = Annotated[TradesService, Depends(get_trades_service)]

@router.get("/suggestions/{team_id}", response_model=TradeSuggestionsResponse)
@limiter.limit("5/minute")
async def get_trades_suggestions_by_team_id(request: Request, team_id: int, trades_service: TradeServiceDep):
    if team_id is None or team_id < 0:
        raise HTTPException(status_code=400, detail="Team ID must be positive")
    
    try:
        return await trades_service.get_trades_suggestions_by_team_id(team_id)
    except DataSourceError as e:
        logger.error(f"Data source error for team {team_id}: {e}")
        raise HTTPException(
            status_code=503, 
            detail="External data source unavailable. Please try again later."
        )
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error getting trades suggestions for team {team_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


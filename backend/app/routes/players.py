from fastapi import APIRouter, HTTPException, Depends
from app.models import Player
from app.exceptions import ResourceNotFoundError
from app.services.player_service import PlayerService
from typing import Annotated, List
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

PlayerServiceDep = Annotated[PlayerService, Depends(PlayerService)]


@router.get("/", response_model=List[Player])
async def get_all_players(
    player_service: PlayerServiceDep
):
    """Get list of all players in the league"""
    try:
        return await player_service.get_all_players()
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error getting all players: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve players list")

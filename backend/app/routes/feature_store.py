from fastapi import APIRouter, HTTPException

from app.models.feature_store_models import (
    PlayersListResponse,
    PlayerStoreState,
    TeamsListResponse,
    TeamStoreState,
)
from app.services import feature_store_debug_service as svc
from model_stats_inference.serving.errors import UnknownPlayerError, UnknownTeamError

router = APIRouter()


@router.get('/players', response_model=PlayersListResponse)
async def get_players() -> PlayersListResponse:
    return await svc.list_players()


@router.get('/players/{player_id}/state', response_model=PlayerStoreState)
async def get_player_state(player_id: int) -> PlayerStoreState:
    try:
        return await svc.player_state(player_id)
    except UnknownPlayerError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get('/teams', response_model=TeamsListResponse)
async def get_teams() -> TeamsListResponse:
    return await svc.list_teams()


@router.get('/teams/{team_id}/state', response_model=TeamStoreState)
async def get_team_state(team_id: int) -> TeamStoreState:
    try:
        return await svc.team_state(team_id)
    except UnknownTeamError as e:
        raise HTTPException(status_code=404, detail=str(e))

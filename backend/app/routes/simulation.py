"""Season-simulation debug API: replay a season day-by-day and inspect predictions.

Endpoints (all under /api/simulation):
  POST /init        reset the sim to a season's start
  GET  /state       current sim date, next game day, scheduled games
  GET  /upcoming    next game day's predictions (default recent-avg minutes)
  POST /predict     re-predict one player with custom minutes (slider)
  POST /advance     reveal the next game day's real results + eval, then step forward
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from app.models.simulation import (
    AdvanceResponse,
    InitRequest,
    PlayerPrediction,
    PlayersListResponse,
    PlayerStoreState,
    PredictPlayerRequest,
    SimState,
    TeamsListResponse,
    TeamStoreState,
    UpcomingResponse,
)
from app.services.simulation_service import SimulationService
from model_stats_inference.serving.errors import (
    ModelsNotTrainedError,
    ServingError,
    UnknownPlayerError,
    UnknownTeamError,
)

router = APIRouter()
logger = logging.getLogger(__name__)


def _service() -> SimulationService:
    return SimulationService()


@router.post("/init", response_model=SimState)
async def init_sim(body: InitRequest | None = None):
    try:
        return await _service().init(body.season if body else None)
    except ModelsNotTrainedError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except ServingError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/state", response_model=SimState)
async def get_state():
    return await _service().state()


@router.get("/upcoming", response_model=UpcomingResponse)
async def get_upcoming():
    try:
        return await _service().upcoming()
    except ModelsNotTrainedError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/predict", response_model=PlayerPrediction)
async def predict_player(body: PredictPlayerRequest):
    try:
        return await _service().predict_player(body.player_id, body.minutes)
    except ServingError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/advance", response_model=AdvanceResponse)
async def advance():
    return await _service().advance()


@router.get("/players", response_model=PlayersListResponse)
async def list_players():
    return await _service().players()


@router.get("/player/{player_id}/state", response_model=PlayerStoreState)
async def player_state(player_id: int):
    try:
        return await _service().player_state(player_id)
    except UnknownPlayerError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/teams", response_model=TeamsListResponse)
async def list_teams():
    return await _service().teams()


@router.get("/team/{team_id}/state", response_model=TeamStoreState)
async def team_state(team_id: int):
    try:
        return await _service().team_state(team_id)
    except UnknownTeamError as e:
        raise HTTPException(status_code=404, detail=str(e))

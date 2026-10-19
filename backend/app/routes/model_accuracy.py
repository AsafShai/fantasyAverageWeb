"""Model vs. Reality: how the per-game projections compared with what happened.

mode=pregame grades the projection as it was shown before tip-off (snapshots,
accumulating from when they started); mode=retro grades the nightly
re-prediction made with actual minutes (model_eval_results). Misses, players and
the player module are pre-game only — that's the projection users acted on.
"""

from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException

from app.models.model_accuracy_models import (
    AccuracyMisses,
    AccuracyMode,
    AccuracyPlayers,
    AccuracySummary,
    AccuracyWeekly,
    AccuracyWindow,
    PlayerAccuracy,
)
from app.services import model_accuracy_service

router = APIRouter()


@router.get('/summary', response_model=AccuracySummary)
async def get_summary(mode: AccuracyMode = 'pregame', window: AccuracyWindow = 'season') -> AccuracySummary:
    return AccuracySummary(**await model_accuracy_service.summary(mode, window))


@router.get('/weekly', response_model=AccuracyWeekly)
async def get_weekly(mode: AccuracyMode = 'pregame') -> AccuracyWeekly:
    return AccuracyWeekly(**await model_accuracy_service.weekly(mode))


@router.get('/misses', response_model=AccuracyMisses)
async def get_misses(week: Optional[date] = None) -> AccuracyMisses:
    return AccuracyMisses(**await model_accuracy_service.misses(week))


@router.get('/players', response_model=AccuracyPlayers)
async def get_players() -> AccuracyPlayers:
    return AccuracyPlayers(**await model_accuracy_service.players())


@router.get('/player/{player_id}', response_model=PlayerAccuracy)
async def get_player(player_id: int) -> PlayerAccuracy:
    result = await model_accuracy_service.player(player_id)
    if result is None:
        raise HTTPException(status_code=404, detail='no graded pre-game projections for this player yet')
    return PlayerAccuracy(**result)

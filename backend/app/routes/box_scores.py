from datetime import date

from fastapi import APIRouter, HTTPException, Query

from app.config import settings

from app.services.box_score_service import (
    BoxScoreNotFound,
    BoxScoreUnavailable,
    boxscore_for,
    scoreboard_for,
)
from app.services.box_score_value_service import slate_values

router = APIRouter()


@router.get("/season")
async def season_window():
    """Regular-season first and last game dates, for the box-score calendar."""
    return {
        "start": settings.season_start.isoformat(),
        "end": settings.season_end.isoformat(),
    }


@router.get("/scoreboard")
async def scoreboard(game_date: date = Query(..., alias="date")):
    try:
        return await scoreboard_for(game_date)
    except BoxScoreUnavailable as exc:
        raise HTTPException(status_code=503, detail="Box scores are temporarily unavailable") from exc


@router.get("/scoreboard/values")
async def scoreboard_values(game_date: date = Query(..., alias="date")):
    try:
        return await slate_values(game_date)
    except BoxScoreUnavailable as exc:
        raise HTTPException(status_code=503, detail="Box scores are temporarily unavailable") from exc


@router.get("/games/{game_id}/boxscore")
async def boxscore(game_id: str):
    if not game_id.isdigit():
        raise HTTPException(status_code=404, detail="Game not found")
    try:
        return await boxscore_for(game_id)
    except BoxScoreNotFound as exc:
        raise HTTPException(status_code=404, detail="Game not found") from exc
    except BoxScoreUnavailable as exc:
        raise HTTPException(status_code=503, detail="Box scores are temporarily unavailable") from exc

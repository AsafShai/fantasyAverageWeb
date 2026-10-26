from datetime import date

from fastapi import APIRouter, HTTPException, Query

from app.services.box_score_service import (
    BoxScoreNotFound,
    BoxScoreUnavailable,
    boxscore_for,
    scoreboard_for,
)

router = APIRouter()


@router.get("/scoreboard")
async def scoreboard(game_date: date = Query(..., alias="date")):
    try:
        return await scoreboard_for(game_date)
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

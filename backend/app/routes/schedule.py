from fastapi import APIRouter, HTTPException

from model_stats_inference.espn.client import EspnUnavailableError
from app.services.schedule_service import get_schedule

router = APIRouter()


@router.get("/schedule")
async def season_schedule():
    try:
        return await get_schedule()
    except EspnUnavailableError as exc:
        raise HTTPException(status_code=503, detail="NBA schedule is temporarily unavailable") from exc

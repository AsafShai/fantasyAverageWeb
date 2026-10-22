from datetime import date

from fastapi import APIRouter, HTTPException, Query

from app.models.surprise_models import NightSurprises
from app.services.surprise_service import WINDOW_DAYS, SurpriseService

router = APIRouter()
_service = SurpriseService()


@router.get('/dates', response_model=list[str])
async def get_dates() -> list[str]:
    """Nights with results, newest first."""
    return await _service.dates()


@router.get('/range', response_model=NightSurprises)
async def get_range(
    days: int = Query(..., description="7, 14, or 28 calendar days ending on end"),
    end: date | None = None,
) -> NightSurprises:
    """Average nightly scores over a span ending on ``end`` (latest scored night
    when omitted). One row per player: sum of his scores divided by games played."""
    if days not in WINDOW_DAYS:
        raise HTTPException(status_code=400, detail="days must be 7, 14, or 28")
    window = await _service.window(days, end)
    if window is None:
        raise HTTPException(status_code=404, detail="No results in that span")
    return NightSurprises(**window)


@router.get('/latest', response_model=NightSurprises)
async def get_latest() -> NightSurprises:
    latest = await _service.latest_date()
    if latest is None:
        raise HTTPException(status_code=404, detail='No nights scored yet')
    night = await _service.night(latest)
    if night is None:
        raise HTTPException(status_code=404, detail='No nights scored yet')
    return NightSurprises(**night)


@router.get('/{game_date}', response_model=NightSurprises)
async def get_night(game_date: date) -> NightSurprises:
    night = await _service.night(game_date)
    if night is None:
        raise HTTPException(status_code=404, detail=f'No results for {game_date}')
    return NightSurprises(**night)

from datetime import date

from fastapi import APIRouter, HTTPException, Query

from app.models.surprise_models import NightSurprises, PeriodSurprises
from app.services.surprise_service import SurpriseService

router = APIRouter()
_service = SurpriseService()


@router.get('/dates', response_model=list[str])
async def get_dates() -> list[str]:
    """Nights with results, newest first."""
    return await _service.dates()


@router.get('/latest', response_model=NightSurprises)
async def get_latest() -> NightSurprises:
    latest = await _service.latest_date()
    if latest is None:
        raise HTTPException(status_code=404, detail='No nights scored yet')
    night = await _service.night(latest)
    if night is None:
        raise HTTPException(status_code=404, detail='No nights scored yet')
    return NightSurprises(**night)


# The score sliders' lowest point (the page's SLIDER_MIN): a period sends every
# player-night at least this far from 0 and the page filters from there.
PERIOD_MIN_SCORE = 1.7
MAX_PERIOD_DAYS = 366


@router.get('/period', response_model=PeriodSurprises)
async def get_period(
    start: date,
    end: date,
    min_score: float = Query(PERIOD_MIN_SCORE, ge=1.0, le=4.0),
) -> PeriodSurprises:
    """Booms and busts from ``start`` to ``end`` (inclusive): every
    player-night at least ``min_score`` from 0, one row per player-night."""
    if end < start:
        raise HTTPException(status_code=422, detail='end is before start')
    if (end - start).days >= MAX_PERIOD_DAYS:
        raise HTTPException(status_code=422, detail=f'a period is at most {MAX_PERIOD_DAYS} days')
    period = await _service.period(start, end, min_score)
    if period is None:
        raise HTTPException(status_code=404, detail=f'No results from {start} to {end}')
    return PeriodSurprises(**period)


@router.get('/{game_date}', response_model=NightSurprises)
async def get_night(game_date: date) -> NightSurprises:
    night = await _service.night(game_date)
    if night is None:
        raise HTTPException(status_code=404, detail=f'No results for {game_date}')
    return NightSurprises(**night)

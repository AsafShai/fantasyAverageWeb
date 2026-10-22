from datetime import date

from fastapi import APIRouter, HTTPException, Query

from app.models.surprise_models import FormSurprises, NightSurprises, PeriodSurprises
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


# The period slider's range: p85 (top 15%) to p99.9 (top 0.1%); default p97.5.
PCT_MIN, PCT_MAX = 85.0, 99.9
PCT_DEFAULT = 97.5
MAX_PERIOD_DAYS = 366


@router.get('/period', response_model=PeriodSurprises)
async def get_period(
    start: date,
    end: date,
    good_pct: float = Query(PCT_DEFAULT, ge=PCT_MIN, le=PCT_MAX),
    bad_pct: float = Query(PCT_DEFAULT, ge=PCT_MIN, le=PCT_MAX),
) -> PeriodSurprises:
    """Booms and busts from ``start`` to ``end`` (inclusive), ranked against
    every scored player-night in that range."""
    if end < start:
        raise HTTPException(status_code=422, detail='end is before start')
    if (end - start).days >= MAX_PERIOD_DAYS:
        raise HTTPException(status_code=422, detail=f'a period is at most {MAX_PERIOD_DAYS} days')
    period = await _service.period(start, end, good_pct, bad_pct)
    if period is None:
        raise HTTPException(status_code=404, detail=f'No results from {start} to {end}')
    return PeriodSurprises(**period)


@router.get('/form', response_model=FormSurprises)
async def get_form(start: date, end: date) -> FormSurprises:
    """Form from ``start`` to ``end`` (inclusive): one row per player who
    played, his nightly scores combined over his games."""
    if end < start:
        raise HTTPException(status_code=422, detail='end is before start')
    if (end - start).days >= MAX_PERIOD_DAYS:
        raise HTTPException(status_code=422, detail=f'a period is at most {MAX_PERIOD_DAYS} days')
    form = await _service.form(start, end)
    if form is None:
        raise HTTPException(status_code=404, detail=f'No results from {start} to {end}')
    return FormSurprises(**form)


@router.get('/{game_date}', response_model=NightSurprises)
async def get_night(game_date: date) -> NightSurprises:
    night = await _service.night(game_date)
    if night is None:
        raise HTTPException(status_code=404, detail=f'No results for {game_date}')
    return NightSurprises(**night)

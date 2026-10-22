from datetime import date

from fastapi import APIRouter, HTTPException, Query

from app.models.surprise_models import FormSurprises, NightSurprises, PeriodSurprises, SurpriseRow
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


@router.get('/team-nights', response_model=list[SurpriseRow])
async def get_team_nights(start: date, end: date, team: str) -> list[SurpriseRow]:
    """A fantasy team's nights from ``start`` to ``end``, one row per
    player-night, best first: ``team`` is the league team id, or ``fa`` for
    the five best and five worst free-agent nights."""
    if end < start:
        raise HTTPException(status_code=422, detail='end is before start')
    if (end - start).days >= MAX_PERIOD_DAYS:
        raise HTTPException(status_code=422, detail=f'a period is at most {MAX_PERIOD_DAYS} days')
    if team != 'fa' and not team.isdigit():
        raise HTTPException(status_code=422, detail="team is a league team id or 'fa'")
    rows = await _service.team_nights(start, end, None if team == 'fa' else int(team))
    return [SurpriseRow(**r) for r in rows]


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

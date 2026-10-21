from datetime import date

from fastapi import APIRouter, HTTPException

from app.models.surprise_models import NightSurprises
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


@router.get('/{game_date}', response_model=NightSurprises)
async def get_night(game_date: date) -> NightSurprises:
    night = await _service.night(game_date)
    if night is None:
        raise HTTPException(status_code=404, detail=f'No results for {game_date}')
    return NightSurprises(**night)

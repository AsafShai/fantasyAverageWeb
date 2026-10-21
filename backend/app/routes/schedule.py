from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, Response

from model_stats_inference.espn.client import EspnUnavailableError
from app.services.schedule_service import get_schedule

router = APIRouter()

# The schedule payload is ~460 KB of JSON and the service hands back the same
# cached object for 24h, so encode it once per payload instead of running
# jsonable_encoder + json.dumps over it on every request. The bytes are exactly
# what returning the dict would produce (same encoder, same JSONResponse render).
_rendered: tuple[Any, bytes] | None = None


def _render(payload: Any) -> bytes:
    global _rendered
    if _rendered is None or _rendered[0] is not payload:
        _rendered = (payload, JSONResponse(jsonable_encoder(payload)).body)
    return _rendered[1]


@router.get("/schedule")
async def season_schedule():
    try:
        payload = await get_schedule()
    except EspnUnavailableError as exc:
        raise HTTPException(status_code=503, detail="NBA schedule is temporarily unavailable") from exc
    return Response(content=_render(payload), media_type="application/json")

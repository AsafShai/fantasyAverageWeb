import asyncio
import logging

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from app.models.injury_models import InjuryRecord, InjuryNotification
from app.services import injury_service

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/", response_model=list[InjuryRecord])
async def get_injuries():
    """Return the current in-memory injury report."""
    return list(injury_service.injury_store.values())


@router.get("/notifications", response_model=list[InjuryNotification])
async def get_notifications():
    """Return the last 50 stored notifications."""
    return injury_service.notification_history


@router.get("/status")
async def get_injury_status():
    return {"last_report_time": injury_service.last_report_time}


@router.get("/stream")
async def injury_stream(request: Request):
    """SSE endpoint — pushes InjuryNotification events to connected clients."""
    queue: asyncio.Queue = asyncio.Queue()
    injury_service.sse_subscribers.append(queue)
    logger.info(
        f"SSE client connected. Subscribers: {len(injury_service.sse_subscribers)}"
    )

    async def event_generator():
        try:
            while True:
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=30.0)
                    if isinstance(item, dict) and "_event" in item:
                        yield f"event: {item['_event']}\ndata: {item['data']}\n\n"
                    else:
                        yield f"data: {item.model_dump_json()}\n\n"
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            if queue in injury_service.sse_subscribers:
                injury_service.sse_subscribers.remove(queue)
            logger.info(
                f"SSE client disconnected. Subscribers: {len(injury_service.sse_subscribers)}"
            )

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )

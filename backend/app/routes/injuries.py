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


@router.post("/test-notification")
async def test_notification():
    """Broadcast a fake notification using a real player from the store and persist it."""
    store = injury_service.injury_store
    now_il = injury_service.get_israel_time_str()
    if store:
        key = next(iter(store))
        record = store[key]
        statuses = ["Out", "Questionable", "Doubtful", "Probable", "Available"]
        new_status = next((s for s in statuses if s != record.status), "Out")
        notif = InjuryNotification(
            type="status_change",
            player=record.player,
            team=record.team,
            old_status=record.status,
            new_status=new_status,
            timestamp=now_il,
        )
        store[key] = record.model_copy(update={"status": new_status, "last_update": now_il})
    else:
        notif = InjuryNotification(
            type="added",
            player="Test Player",
            team="Test Team",
            new_status="Out",
            timestamp=now_il,
        )
    await injury_service.broadcast_notifications([notif])
    return {"ok": True, "notification": notif}


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
                    notification = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield f"data: {notification.model_dump_json()}\n\n"
                except asyncio.TimeoutError:
                    # Heartbeat to keep the connection alive
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

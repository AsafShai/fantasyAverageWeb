import logging
import time
from collections import deque

from fastapi import FastAPI, Request
from slowapi.util import get_remote_address

logger = logging.getLogger(__name__)

SLOW_REQUEST_MS = 1000.0
_WINDOW_S = 3600.0

_slow_requests: deque[float] = deque()


def record_slow_request(now: float | None = None) -> None:
    _slow_requests.append(time.time() if now is None else now)


def slow_requests_last_hour() -> int:
    cutoff = time.time() - _WINDOW_S
    while _slow_requests and _slow_requests[0] < cutoff:
        _slow_requests.popleft()
    return len(_slow_requests)


def reset_slow_requests() -> None:
    _slow_requests.clear()


def add_timing_middleware(app: FastAPI) -> None:
    @app.middleware("http")
    async def timing_middleware(request: Request, call_next):
        started = time.perf_counter()
        response = await call_next(request)
        elapsed_ms = (time.perf_counter() - started) * 1000
        response.headers["X-Process-Time"] = f"{elapsed_ms:.1f}"
        if elapsed_ms >= SLOW_REQUEST_MS:
            record_slow_request()
            logger.warning(
                "slow_request %s %s %.0fms %s",
                request.method,
                request.url.path,
                elapsed_ms,
                get_remote_address(request),
            )
        return response

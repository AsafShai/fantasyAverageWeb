import logging
import time
from collections import deque

from fastapi import FastAPI, Request
from slowapi.util import get_remote_address

from app.utils.request_context import REQUEST_ID_HEADER, new_request_id, request_id_var

logger = logging.getLogger(__name__)

SLOW_REQUEST_MS = 1000.0
_WINDOW_S = 3600.0

# Polled by the Docker healthcheck / uptime probes every few seconds; logging
# each hit at INFO would bury the real traffic.
_QUIET_PATHS = frozenset({"/health", "/"})

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


def _target(request: Request) -> str:
    query = request.url.query
    return f"{request.url.path}?{query}" if query else request.url.path


def add_timing_middleware(app: FastAPI) -> None:
    @app.middleware("http")
    async def timing_middleware(request: Request, call_next):
        # Not reset afterwards on purpose: each request runs in its own task,
        # and the unhandled-exception handler (outermost, in Starlette's
        # ServerErrorMiddleware) runs after this returns and should still
        # carry the id.
        request_id = new_request_id(request.headers.get(REQUEST_ID_HEADER))
        request_id_var.set(request_id)

        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            elapsed_ms = (time.perf_counter() - started) * 1000
            logger.error(
                "request %s %s -> unhandled exception %.0fms %s",
                request.method, _target(request), elapsed_ms, get_remote_address(request),
            )
            raise
        elapsed_ms = (time.perf_counter() - started) * 1000
        response.headers["X-Process-Time"] = f"{elapsed_ms:.1f}"
        response.headers[REQUEST_ID_HEADER] = request_id

        # Set by the exception handlers in main.py so a 4xx/5xx line says why.
        detail = getattr(request.state, "error_detail", None)
        suffix = f" detail={detail!r}" if detail else ""
        args = (
            request.method, _target(request), response.status_code, elapsed_ms,
            get_remote_address(request), suffix,
        )

        if elapsed_ms >= SLOW_REQUEST_MS:
            record_slow_request()
            logger.warning("slow_request %s %s -> %d %.0fms %s%s", *args)
        elif response.status_code >= 500:
            logger.warning("request %s %s -> %d %.0fms %s%s", *args)
        elif request.url.path in _QUIET_PATHS:
            logger.debug("request %s %s -> %d %.0fms %s%s", *args)
        else:
            logger.info("request %s %s -> %d %.0fms %s%s", *args)
        return response

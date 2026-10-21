import logging
import time
from collections import deque

from fastapi import FastAPI, Request
from fastapi.responses import Response
from slowapi.util import get_remote_address

from app.utils.request_context import (
    REQUEST_ID_HEADER,
    UpstreamCalls,
    new_request_id,
    request_id_var,
    trigger_var,
    upstream_var,
)

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


def _describe(status: int | str, elapsed_ms: float, request: Request, calls: UpstreamCalls, extra: str = "") -> str:
    parts = [f"-> {status} {elapsed_ms:.0f}ms"]
    if extra:
        parts.append(extra)
    if request.url.query:
        parts.append(f"query={request.url.query}")
    upstream = calls.summary()
    if upstream:
        parts.append(upstream)
    parts.append(f"ip={get_remote_address(request)}")
    return " ".join(parts)


def add_timing_middleware(app: FastAPI) -> None:
    @app.middleware("http")
    async def timing_middleware(request: Request, call_next):
        # Not reset afterwards on purpose: each request runs in its own task,
        # and the unhandled-exception handler (outermost, in Starlette's
        # ServerErrorMiddleware) runs after this returns and should still
        # carry the id.
        request_id = new_request_id(request.headers.get(REQUEST_ID_HEADER))
        request_id_var.set(request_id)
        trigger_var.set(f"{request.method} {request.url.path}")
        calls = UpstreamCalls()
        upstream_var.set(calls)

        started = time.perf_counter()
        try:
            response = await call_next(request)
        except RuntimeError as exc:
            # Starlette raises this when the client hangs up before the
            # response starts (typically an SSE tab closed); nothing failed.
            if str(exc) != "No response returned." or not await request.is_disconnected():
                _log_unhandled(request, calls, started)
                raise
            elapsed_ms = (time.perf_counter() - started) * 1000
            logger.info(_describe("client disconnected", elapsed_ms, request, calls))
            return Response(status_code=499)
        except Exception:
            _log_unhandled(request, calls, started)
            raise
        elapsed_ms = (time.perf_counter() - started) * 1000
        response.headers["X-Process-Time"] = f"{elapsed_ms:.1f}"
        response.headers[REQUEST_ID_HEADER] = request_id

        if response.headers.get("content-type", "").startswith("text/event-stream"):
            logger.info(_describe(response.status_code, elapsed_ms, request, calls, "stream opened"))
            return response

        # Set by the exception handlers in main.py so a 4xx/5xx line says why.
        detail = getattr(request.state, "error_detail", None)
        extra = f"detail={detail!r}" if detail else ""
        is_slow = elapsed_ms >= SLOW_REQUEST_MS
        if is_slow:
            record_slow_request()
            extra = f"SLOW {extra}".strip()
        line = _describe(response.status_code, elapsed_ms, request, calls, extra)

        if is_slow or response.status_code >= 500:
            logger.warning(line)
        elif request.url.path in _QUIET_PATHS:
            logger.debug(line)
        else:
            logger.info(line)
        return response


def _log_unhandled(request: Request, calls: UpstreamCalls, started: float) -> None:
    """Logs the failing request once, with its traceback; the app-level
    handler in main.py sees the flag and skips its own copy."""
    elapsed_ms = (time.perf_counter() - started) * 1000
    logger.exception(_describe("unhandled exception", elapsed_ms, request, calls))
    request.state.exception_logged = True

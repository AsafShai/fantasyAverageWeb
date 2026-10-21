import asyncio
import logging
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient

from app.utils import timing_middleware
from app.utils.request_context import HttpxTallyFilter
from app.utils.timing_middleware import add_timing_middleware


def _app_with_delay(delay_s: float) -> FastAPI:
    app = FastAPI()
    add_timing_middleware(app)

    @app.get("/slow")
    async def slow():
        await asyncio.sleep(delay_s)
        return {"ok": True}

    return app


def test_fast_request_sets_header_and_is_not_counted():
    timing_middleware.reset_slow_requests()
    response = TestClient(_app_with_delay(0)).get("/slow")
    assert response.status_code == 200
    assert float(response.headers["X-Process-Time"]) >= 0
    assert timing_middleware.slow_requests_last_hour() == 0


def test_slow_request_is_logged_and_counted(caplog):
    timing_middleware.reset_slow_requests()
    client = TestClient(_app_with_delay(0))
    with patch.object(timing_middleware, "SLOW_REQUEST_MS", 0.0):
        with caplog.at_level(logging.WARNING, logger="app.utils.timing_middleware"):
            response = client.get("/slow")
    assert float(response.headers["X-Process-Time"]) >= 0
    assert timing_middleware.slow_requests_last_hour() == 1
    assert any(r.getMessage().startswith("-> 200") and "SLOW" in r.getMessage() for r in caplog.records)


def test_slow_request_counter_drops_entries_older_than_an_hour():
    timing_middleware.reset_slow_requests()
    timing_middleware.record_slow_request(now=0.0)
    timing_middleware.record_slow_request()
    assert timing_middleware.slow_requests_last_hour() == 1


def test_request_id_is_minted_or_propagated_and_logged(caplog):
    client = TestClient(_app_with_delay(0))
    with caplog.at_level(logging.INFO, logger="app.utils.timing_middleware"):
        minted = client.get("/slow?x=1")
        echoed = client.get("/slow", headers={"X-Request-ID": "trace-42"})
    assert len(minted.headers["X-Request-ID"]) == 8
    assert echoed.headers["X-Request-ID"] == "trace-42"
    assert any(
        r.getMessage().startswith("-> 200") and "query=x=1" in r.getMessage()
        for r in caplog.records
    )


def test_access_line_carries_error_detail_set_by_handler(caplog):
    from fastapi import HTTPException, Request
    from fastapi.exception_handlers import http_exception_handler
    from starlette.exceptions import HTTPException as StarletteHTTPException

    app = FastAPI()
    add_timing_middleware(app)

    @app.exception_handler(StarletteHTTPException)
    async def handler(request: Request, exc):
        request.state.error_detail = exc.detail
        return await http_exception_handler(request, exc)

    @app.get("/missing")
    async def missing():
        raise HTTPException(status_code=404, detail="Team 99 not found")

    with caplog.at_level(logging.INFO, logger="app.utils.timing_middleware"):
        response = TestClient(app).get("/missing")
    assert response.status_code == 404
    assert any(
        "-> 404" in r.getMessage() and "Team 99 not found" in r.getMessage()
        for r in caplog.records
    )


def test_health_probe_is_not_logged_at_info(caplog):
    app = FastAPI()
    add_timing_middleware(app)

    @app.get("/health")
    async def health():
        return {"ok": True}

    with caplog.at_level(logging.INFO, logger="app.utils.timing_middleware"):
        TestClient(app).get("/health")
    assert not [r for r in caplog.records if "/health" in r.getMessage()]


def test_request_line_tallies_upstream_calls_instead_of_logging_each(caplog):
    app = FastAPI()
    add_timing_middleware(app)
    httpx_logger = logging.getLogger("httpx")
    httpx_logger.addFilter(HttpxTallyFilter())

    @app.get("/fanout")
    async def fanout():
        for status in (200, 200, 503):
            httpx_logger.info(
                'HTTP Request: %s %s "%s %d %s"',
                "GET", "https://site.api.espn.com/apis/x", "HTTP/1.1", status, "OK",
            )
        return {"ok": True}

    try:
        with caplog.at_level(logging.INFO):
            TestClient(app).get("/fanout")
    finally:
        httpx_logger.filters.clear()

    assert not [r for r in caplog.records if r.name == "httpx"]
    [line] = [r.getMessage() for r in caplog.records if r.name == "app.utils.timing_middleware"]
    assert "upstream[espn-site x3] failed: espn-site 503" in line


def test_event_stream_is_logged_as_opened_not_slow(caplog):
    app = FastAPI()
    add_timing_middleware(app)

    @app.get("/stream")
    async def stream():
        async def gen():
            yield ": connected\n\n"
        return StreamingResponse(gen(), media_type="text/event-stream")

    timing_middleware.reset_slow_requests()
    with patch.object(timing_middleware, "SLOW_REQUEST_MS", 0.0):
        with caplog.at_level(logging.INFO, logger="app.utils.timing_middleware"):
            TestClient(app).get("/stream")
    assert timing_middleware.slow_requests_last_hour() == 0
    assert any("stream opened" in r.getMessage() for r in caplog.records)


def test_unhandled_exception_is_logged_once_with_traceback(caplog):
    app = FastAPI()
    add_timing_middleware(app)

    @app.get("/boom")
    async def boom():
        raise ValueError("kaboom")

    with caplog.at_level(logging.ERROR):
        TestClient(app, raise_server_exceptions=False).get("/boom")
    errors = [r for r in caplog.records if r.levelno >= logging.ERROR and r.name.startswith("app.")]
    assert len(errors) == 1
    assert errors[0].exc_info is not None

import asyncio
import logging
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.utils import timing_middleware
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
    assert any("slow_request GET /slow" in record.getMessage() for record in caplog.records)


def test_slow_request_counter_drops_entries_older_than_an_hour():
    timing_middleware.reset_slow_requests()
    timing_middleware.record_slow_request(now=0.0)
    timing_middleware.record_slow_request()
    assert timing_middleware.slow_requests_last_hour() == 1

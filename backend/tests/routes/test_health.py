from unittest.mock import AsyncMock, patch

import pytest

from app.main import limiter
from app.services import health_service
from app.utils import timing_middleware


@pytest.fixture(autouse=True)
def _reset_limiter():
    limiter.reset()
    timing_middleware.reset_slow_requests()
    yield
    limiter.reset()


def test_health_default_response_unchanged(test_client):
    response = test_client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "healthy"
    assert body["service"] == "Fantasy League Dashboard API"
    assert "timestamp" in body
    assert "db" not in body
    assert "slow_requests_1h" not in body


def test_health_verbose_has_all_sections(test_client):
    with patch.object(health_service.DBService, "_get_pool", AsyncMock(return_value=None)), \
         patch.object(health_service.DBService, "get_latest_model_nightly_run", AsyncMock(return_value=None)):
        response = test_client.get("/health?verbose=1")
    assert response.status_code == 200
    body = response.json()
    for key in ("uptime_s", "db", "espn", "injury", "nightly", "estimator", "schedulers", "slow_requests_1h"):
        assert key in body
    assert body["injury"]["ok"] is True
    assert body["schedulers"]["injury_next"]
    assert body["nightly"]["last_date"] is None


def test_health_verbose_survives_db_down(test_client):
    with patch.object(health_service.DBService, "_get_pool", AsyncMock(side_effect=OSError("boom"))), \
         patch.object(health_service.DBService, "get_latest_model_nightly_run", AsyncMock(return_value=None)):
        response = test_client.get("/health?verbose=1")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "healthy"
    assert body["db"]["ok"] is False
    assert body["db"]["error"] == "OSError"


def test_health_verbose_reports_no_pool_as_not_ok(test_client):
    with patch.object(health_service.DBService, "_get_pool", AsyncMock(return_value=None)), \
         patch.object(health_service.DBService, "get_latest_model_nightly_run", AsyncMock(return_value=None)):
        body = test_client.get("/health?verbose=1").json()
    assert body["db"] == {"ok": False, "error": "no_pool"}


def test_health_verbose_leaks_no_connection_details(test_client):
    with patch.object(health_service.DBService, "_get_pool", AsyncMock(side_effect=OSError("postgres://user:pw@ep-x.neon.tech/db"))), \
         patch.object(health_service.DBService, "get_latest_model_nightly_run", AsyncMock(return_value=None)):
        raw = test_client.get("/health?verbose=1").text
    assert "neon.tech" not in raw
    assert "postgres://" not in raw


def test_health_response_carries_process_time_header(test_client):
    response = test_client.get("/health")
    assert float(response.headers["X-Process-Time"]) >= 0


def test_health_reports_deployed_commit(test_client, monkeypatch):
    # Render sets RENDER_GIT_COMMIT on git-backed services; the post-deploy
    # smoke check polls /health until it reports the commit it just deployed.
    monkeypatch.setenv("RENDER_GIT_COMMIT", "abc123")
    assert test_client.get("/health").json()["commit"] == "abc123"


def test_health_commit_is_null_outside_render(test_client, monkeypatch):
    monkeypatch.delenv("RENDER_GIT_COMMIT", raising=False)
    assert test_client.get("/health").json()["commit"] is None

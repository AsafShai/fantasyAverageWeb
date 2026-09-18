import pytest
from fastapi.testclient import TestClient
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from app.main import app, limiter


@pytest.fixture
def proxied_client():
    """Mirrors the production server, which runs uvicorn with
    proxy_headers=True / forwarded_allow_ips='*'."""
    limiter.reset()
    yield TestClient(ProxyHeadersMiddleware(app, trusted_hosts="*"))
    limiter.reset()


def test_no_default_limits_configured():
    assert limiter._default_limits == []


def test_health_limit_still_applies_per_client(proxied_client):
    for _ in range(60):
        assert proxied_client.get("/health", headers={"X-Forwarded-For": "203.0.113.7"}).status_code == 200
    assert proxied_client.get("/health", headers={"X-Forwarded-For": "203.0.113.7"}).status_code == 429


def test_distinct_forwarded_ips_get_distinct_buckets(proxied_client):
    for i in range(61):
        response = proxied_client.get("/health", headers={"X-Forwarded-For": f"198.51.100.{i}"})
        assert response.status_code == 200


def test_forwarded_for_chain_uses_leftmost_client(proxied_client):
    for _ in range(60):
        proxied_client.get("/health", headers={"X-Forwarded-For": "203.0.113.9, 10.0.0.1"})
    assert proxied_client.get("/health", headers={"X-Forwarded-For": "203.0.113.9"}).status_code == 429
    assert proxied_client.get("/health", headers={"X-Forwarded-For": "203.0.113.10"}).status_code == 200

"""The real app: which endpoints carry ETag/Cache-Control, and that a
revalidation with a matching ETag gets a 304 while bodies stay unchanged."""
from unittest.mock import AsyncMock, patch

import pytest

from app.main import app
from app.utils.http_cache import CACHE_RULES

SCHEDULE = {"season": "2026-27", "teams": [{"team_id": 1, "games": []}], "calendar_days": []}


@pytest.mark.parametrize("path", ["/api/nba/schedule", "/api/league/draft-report", "/api/adp",
                                  "/api/adp/index", "/api/estimator/results"])
def test_cached_endpoints_are_configured(path):
    assert path in CACHE_RULES


def test_middleware_is_installed_inside_gzip():
    # the ETag must hash the uncompressed body: gzip output embeds a timestamp
    names = [m.cls.__name__ for m in app.user_middleware]
    assert names.index("GZipMiddleware") < names.index("HttpCacheMiddleware")


@patch("app.routes.schedule.get_schedule", new_callable=AsyncMock, return_value=SCHEDULE)
def test_schedule_body_unchanged_and_revalidates(_mock, test_client):
    first = test_client.get("/api/nba/schedule")
    assert first.status_code == 200
    assert first.json() == SCHEDULE
    assert first.headers["cache-control"] == CACHE_RULES["/api/nba/schedule"]

    again = test_client.get("/api/nba/schedule", headers={"If-None-Match": first.headers["etag"]})
    assert again.status_code == 304
    assert again.content == b""


@patch("app.routes.schedule.get_schedule", new_callable=AsyncMock, return_value=SCHEDULE)
def test_schedule_gzip_still_applies_to_200(_mock, test_client):
    big = {**SCHEDULE, "pad": "x" * 5000}
    _mock.return_value = big
    r = test_client.get("/api/nba/schedule", headers={"Accept-Encoding": "gzip"})
    assert r.headers.get("content-encoding") == "gzip"
    assert r.json() == big

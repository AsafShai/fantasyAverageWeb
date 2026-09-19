import json
from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.models import PaginatedPlayers, StatTimePeriod
from app.config import settings
from unittest.mock import patch

client = TestClient(app)


def test_get_all_players_default():
    """Test getting all players with default time period (season)"""
    response = client.get("/api/players/")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(PaginatedPlayers(**data), PaginatedPlayers)
    assert "players" in data
    assert "total_count" in data
    assert isinstance(data["players"], list)


def test_get_all_players_season():
    """Test getting all players with season time period"""
    response = client.get("/api/players/?time_period=season")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(PaginatedPlayers(**data), PaginatedPlayers)


def test_get_all_players_last_7():
    """Test getting all players with last_7 time period"""
    response = client.get("/api/players/?time_period=last_7")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(PaginatedPlayers(**data), PaginatedPlayers)


def test_get_all_players_last_15():
    """Test getting all players with last_15 time period"""
    response = client.get("/api/players/?time_period=last_15")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(PaginatedPlayers(**data), PaginatedPlayers)


def test_get_all_players_last_30():
    """Test getting all players with last_30 time period"""
    response = client.get("/api/players/?time_period=last_30")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(PaginatedPlayers(**data), PaginatedPlayers)


def test_get_all_players_invalid_time_period():
    """Test getting all players with invalid time period"""
    response = client.get("/api/players/?time_period=invalid")
    assert response.status_code == 422


def test_get_all_players_pagination():
    """Test pagination with time period"""
    response = client.get("/api/players/?page=1&limit=10&time_period=season")
    assert response.status_code == 200
    data = response.json()
    assert data["page"] == 1
    assert data["limit"] == 10
    assert len(data["players"]) <= 10


def test_get_all_players_different_stats_per_period():
    """Test that API accepts different time periods correctly (mock data will be same)"""
    season_response = client.get("/api/players/?limit=10&time_period=season")
    last_7_response = client.get("/api/players/?limit=10&time_period=last_7")

    assert season_response.status_code == 200
    assert last_7_response.status_code == 200

    season_data = season_response.json()
    last_7_data = last_7_response.json()

    assert len(season_data["players"]) > 0
    assert len(last_7_data["players"]) > 0


@patch('app.services.player_service.PlayerService.get_all_players')
def test_get_all_players_error(mock_get_all_players):
    """Test error handling when service fails"""
    from app.exceptions import ResourceNotFoundError
    mock_get_all_players.side_effect = ResourceNotFoundError("Service error")
    response = client.get("/api/players/")
    assert response.status_code == 404
    assert "Service error" in response.json()["detail"]


def test_get_all_players_custom_valid_range():
    """Custom period with a valid start/end within the season succeeds"""
    start = settings.season_start + timedelta(days=1)
    end = start + timedelta(days=5)
    response = client.get(f"/api/players/?time_period=custom&start={start}&end={end}")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(PaginatedPlayers(**data), PaginatedPlayers)


def test_get_all_players_custom_missing_start_and_end():
    response = client.get("/api/players/?time_period=custom")
    assert response.status_code == 422
    assert "requires both start and end" in response.json()["detail"]


def test_get_all_players_custom_missing_end():
    start = settings.season_start + timedelta(days=1)
    response = client.get(f"/api/players/?time_period=custom&start={start}")
    assert response.status_code == 422
    assert "requires both start and end" in response.json()["detail"]


def test_get_all_players_custom_start_after_end():
    start = settings.season_start + timedelta(days=5)
    end = settings.season_start + timedelta(days=1)
    response = client.get(f"/api/players/?time_period=custom&start={start}&end={end}")
    assert response.status_code == 422
    assert "start must be before end" in response.json()["detail"]


def test_get_all_players_custom_start_before_season():
    start = settings.season_start - timedelta(days=1)
    end = settings.season_start + timedelta(days=5)
    response = client.get(f"/api/players/?time_period=custom&start={start}&end={end}")
    assert response.status_code == 422
    assert "season start" in response.json()["detail"]


def test_get_all_players_custom_end_in_future():
    start = settings.season_start + timedelta(days=1)
    end = date.today() + timedelta(days=1)
    response = client.get(f"/api/players/?time_period=custom&start={start}&end={end}")
    assert response.status_code == 422
    assert "future" in response.json()["detail"]


GOLDEN_PATH = Path(__file__).resolve().parents[1] / "fixtures" / "players_response_golden.json"


def _golden():
    with open(GOLDEN_PATH) as f:
        return json.load(f)


@pytest.mark.parametrize("time_period", ["season", "last_7", "last_15", "last_30"])
def test_players_response_matches_golden(time_period):
    expected = _golden()[time_period]
    response = client.get(f"/api/players/?time_period={time_period}&limit=1200")
    assert response.status_code == 200
    assert response.json() == expected


@pytest.mark.parametrize("key,query", [
    ("season_p1_l10", "page=1&limit=10"),
    ("season_p2_l10", "page=2&limit=10"),
])
def test_players_paginated_response_matches_golden(key, query):
    expected = _golden()[key]
    response = client.get(f"/api/players/?time_period=season&{query}")
    assert response.status_code == 200
    assert response.json() == expected


def test_players_response_cached_page_matches_golden():
    client.get("/api/players/?time_period=season&limit=1200")
    response = client.get("/api/players/?time_period=season&page=1&limit=10")
    assert response.status_code == 200
    assert response.json() == _golden()["season_p1_l10"]


class TestPlayersETag:
    def test_warm_request_sets_weak_etag_and_cache_control(self):
        client.get("/api/players/?time_period=season&limit=1200")
        response = client.get("/api/players/?time_period=season&limit=1200")
        assert response.status_code == 200
        assert response.headers["etag"].startswith('W/"')
        assert response.headers["cache-control"] == "private, max-age=0, must-revalidate"

    def test_matching_if_none_match_returns_304_empty_body(self):
        client.get("/api/players/?time_period=season&limit=1200")
        warm = client.get("/api/players/?time_period=season&limit=1200")
        etag = warm.headers["etag"]

        response = client.get(
            "/api/players/?time_period=season&limit=1200",
            headers={"If-None-Match": etag},
        )
        assert response.status_code == 304
        assert response.content == b""
        assert response.headers["etag"] == etag

    def test_different_if_none_match_returns_200_with_current_etag(self):
        client.get("/api/players/?time_period=season&limit=1200")
        warm = client.get("/api/players/?time_period=season&limit=1200")
        etag = warm.headers["etag"]

        response = client.get(
            "/api/players/?time_period=season&limit=1200",
            headers={"If-None-Match": 'W/"deadbeef"'},
        )
        assert response.status_code == 200
        assert response.headers["etag"] == etag
        assert response.json() == _golden()["season"]

    def test_etag_differs_by_page_and_limit(self):
        client.get("/api/players/?time_period=season&limit=1200")
        full = client.get("/api/players/?time_period=season&limit=1200").headers["etag"]
        paged = client.get("/api/players/?time_period=season&page=1&limit=10").headers["etag"]
        page2 = client.get("/api/players/?time_period=season&page=2&limit=10").headers["etag"]
        assert full != paged != page2
        assert full != page2

    def test_etag_differs_by_time_period(self):
        client.get("/api/players/?time_period=season&limit=1200")
        season = client.get("/api/players/?time_period=season&limit=1200").headers["etag"]
        client.get("/api/players/?time_period=last_7&limit=1200")
        last7 = client.get("/api/players/?time_period=last_7&limit=1200").headers["etag"]
        assert season != last7

    def test_custom_range_has_no_etag(self):
        start = settings.season_start + timedelta(days=1)
        end = start + timedelta(days=5)
        url = f"/api/players/?time_period=custom&start={start}&end={end}"
        client.get(url)
        response = client.get(url)
        assert response.status_code == 200
        assert "etag" not in response.headers

    def test_if_none_match_ignored_on_cold_cache(self):
        response = client.get(
            "/api/players/?time_period=last_30&limit=1200",
            headers={"If-None-Match": 'W/"deadbeef"'},
        )
        assert response.status_code == 200
        assert response.json() == _golden()["last_30"]

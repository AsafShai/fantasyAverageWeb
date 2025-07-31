from fastapi.testclient import TestClient
from app.main import app
from app.models import LeagueRankings
import pytest

client = TestClient(app)


sort_by_to_attribute = {
    "PTS": "pts",
    "REB": "reb",
    "AST": "ast",
    "FG%": "fg_percentage",
    "FT%": "ft_percentage",
    "3PM": "three_pm",
    "STL": "stl",
    "BLK": "blk",
    "TOTAL_POINTS": "total_points",
    "RANK": "rank",
}   

def _build_rankings_url(sort_by=None, order=None):
    """Build rankings URL with query parameters"""
    url = "/api/rankings"
    params = []
    if sort_by is not None:
        params.append(f"sort_by={sort_by}")
    if order:
        params.append(f"order={order}")
    if params:
        url += "?" + "&".join(params)
    return url

def _get_valid_rankings(sort_by=None, order=None) -> LeagueRankings:
    """Get rankings expecting 200 status - returns LeagueRankings object"""
    url = _build_rankings_url(sort_by, order)
    response = client.get(url)
    assert response.status_code == 200
    data = response.json()
    league_rankings = LeagueRankings(**data)
    assert isinstance(league_rankings, LeagueRankings), f"Response is not a LeagueRankings object: {data}"
    return league_rankings

def _get_rankings_response(sort_by=None, order=None, expected_status=422):
    """Get rankings response expecting error status - returns Response object"""
    url = _build_rankings_url(sort_by, order)
    response = client.get(url)
    assert response.status_code == expected_status
    return response

def test_get_rankings_default():
    """Test that the rankings are returned correctly"""
    _get_valid_rankings()

@pytest.mark.parametrize("sort_by", ["rank", "total_points", "fg%"])
def test_get_rankings_with_sort_by(sort_by):
    """Test that the rankings are sorted by the sort_by column, order default is asc"""
    league_rankings = _get_valid_rankings(sort_by=sort_by)
    expected_sorted = sorted(league_rankings.rankings, key=lambda x: getattr(x, sort_by_to_attribute[sort_by.upper()]), reverse=True)
    assert league_rankings.rankings == expected_sorted

@pytest.mark.parametrize("order", ["asc", "desc"])
def test_get_rankings_with_order_without_sort_by(order):
    """Test that the rankings are sorted by the rank column, order default is asc"""
    league_rankings = _get_valid_rankings(order=order)
    expected_sorted = sorted(league_rankings.rankings, key=lambda x: getattr(x, "rank"), reverse=order == "desc")
    assert league_rankings.rankings == expected_sorted

@pytest.mark.parametrize("sort_by", ["rank", "total_points", "pts"])
@pytest.mark.parametrize("order", ["asc", "desc"])
def test_get_rankings_with_order_and_sort_by(sort_by, order):
    """Test that the rankings are sorted by the sort_by column, order default is asc"""
    league_rankings = _get_valid_rankings(sort_by=sort_by, order=order)
    expected_sorted = sorted(league_rankings.rankings, key=lambda x: getattr(x, sort_by_to_attribute[sort_by.upper()]), reverse=order == "desc")
    assert league_rankings.rankings == expected_sorted

def test_get_rankings_with_invalid_sort_by():
    """Test that invalid sort_by returns 422 status code"""
    response = _get_rankings_response(sort_by="invalid_column", expected_status=422)
    assert "Invalid sort column" in response.json()["detail"]

def test_get_rankings_with_invalid_order():
    """Test that invalid order returns 422 status code (handled by FastAPI validation)"""
    response = client.get("/api/rankings?order=invalid_order")
    assert response.status_code == 422
    
def test_get_rankings_with_empty_sort_by():
    """Test that empty sort_by is handled gracefully"""
    response = _get_rankings_response(sort_by="", expected_status=422)
    assert "Invalid sort column" in response.json()["detail"]

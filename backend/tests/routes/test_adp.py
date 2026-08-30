from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest

from app.models.adp import AdpIndexResponse, AdpPlayer, AdpResponse, SiteAdp
from app.services.adp_service import get_adp_response, reset_adp_cache


def test_adp_route_returns_payload(test_client):
    fake = AdpResponse(
        season_label="2025-26",
        updated_at="2026-08-21T00:00:00Z",
        sources={"espn": "test"},
        players=[
            AdpPlayer(
                id="3112335",
                espn_id=3112335,
                name="Nikola Jokic",
                team_abbr="DEN",
                positions=["C"],
                espn=SiteAdp(adp=1.7, rank=1),
                blend=1.7,
                blend_rank=1,
            )
        ],
    )
    with patch("app.routes.adp.get_adp_response_enriched", new_callable=AsyncMock, return_value=fake):
        response = test_client.get("/api/adp")
    assert response.status_code == 200
    body = response.json()
    assert body["season_label"] == "2025-26"
    assert body["players"][0]["name"] == "Nikola Jokic"
    assert body["players"][0]["blend"] == 1.7


def test_adp_route_serves_live_payload(test_client):
    reset_adp_cache()
    payload = {
        "seasonLabel": "2025-26",
        "updatedAt": "2026-08-21T00:00:00Z",
        "sources": {"espn": "espn-src", "fantrax": "fantrax-src", "sleeper": "sleeper-src"},
        "players": [
            {
                "espn_id": 3112335,
                "name": "Nikola Jokic",
                "positions": ["C"],
                "adp": {"espn": 1.0, "fantrax": 1.5, "sleeper": 2.0},
            }
        ],
    }
    with patch("app.services.adp_service.fetch_live_adp_payload", new_callable=AsyncMock, return_value=payload):
        response = test_client.get("/api/adp")
    assert response.status_code == 200
    body = response.json()
    assert body["season_label"] == "2025-26"
    assert body["sources"]["espn"] == "espn-src"
    jokic = next(p for p in body["players"] if p["name"] == "Nikola Jokic")
    assert jokic["espn"]["adp"] == 1.0
    assert jokic["blend"] is not None
    assert "photo_url" in jokic
    assert "positions" in jokic
    assert body["page"] == 1
    assert body["total"] >= 1
    assert len(body["players"]) <= body["page_size"]


def test_adp_route_pages_results(test_client):
    reset_adp_cache()
    payload = {
        "seasonLabel": "2025-26",
        "updatedAt": "2026-08-21T00:00:00Z",
        "sources": {"espn": "espn-src"},
        "players": [
            {"espn_id": 9000001, "name": "Alpha", "adp": {"espn": 1.0}},
            {"espn_id": 9000002, "name": "Bravo", "adp": {"espn": 2.0}},
            {"espn_id": 9000003, "name": "Charlie", "adp": {"espn": 3.0}},
        ],
    }
    with patch("app.services.adp_service.fetch_live_adp_payload", new_callable=AsyncMock, return_value=payload):
        first = test_client.get("/api/adp", params={"page": 1, "page_size": 2, "sort": "blend"})
        second = test_client.get("/api/adp", params={"page": 2, "page_size": 2, "sort": "blend"})
        index = test_client.get("/api/adp/index")
    assert first.status_code == 200
    assert first.json()["total"] == 3
    assert len(first.json()["players"]) == 2
    assert first.json()["players"][0]["name"] == "Alpha"
    assert len(second.json()["players"]) == 1
    assert second.json()["players"][0]["name"] == "Charlie"
    assert index.status_code == 200
    assert index.json()["total"] == 3
    assert "photo_url" not in index.json()["players"][0]
    assert "last_year" not in index.json()["players"][0]


def test_adp_route_blend_uses_checked_sites_only(test_client):
    reset_adp_cache()
    payload = {
        "seasonLabel": "2025-26",
        "updatedAt": "2026-08-21T00:00:00Z",
        "sources": {"espn": "espn-src", "fantrax": "fantrax-src", "sleeper": "sleeper-src"},
        "players": [
            {
                "espn_id": 9000001,
                "name": "Early Espn",
                "adp": {"espn": 1.0, "fantrax": 2.0, "sleeper": 3.0},
            },
            {
                "espn_id": 9000002,
                "name": "Early Fantrax",
                "adp": {"espn": 40.0, "fantrax": 1.0, "sleeper": 2.0},
            },
        ],
    }
    with patch("app.services.adp_service.fetch_live_adp_payload", new_callable=AsyncMock, return_value=payload):
        all_sites = test_client.get("/api/adp", params={"sort": "blend", "page_size": 10})
        subset = test_client.get(
            "/api/adp", params={"sort": "blend", "page_size": 10, "sites": "fantrax,sleeper"}
        )
        by_ids = test_client.get(
            "/api/adp", params={"ids": "9000001,9000002", "sites": "fantrax,sleeper"}
        )
        index = test_client.get("/api/adp/index")
    assert all_sites.status_code == 200
    all_names = [p["name"] for p in all_sites.json()["players"] if p["name"] in {"Early Espn", "Early Fantrax"}]
    assert all_names[0] == "Early Espn"
    espn_row = next(p for p in all_sites.json()["players"] if p["name"] == "Early Espn")
    assert espn_row["blend"] == 2.0

    assert subset.status_code == 200
    subset_names = [p["name"] for p in subset.json()["players"] if p["name"] in {"Early Espn", "Early Fantrax"}]
    assert subset_names[0] == "Early Fantrax"
    fantrax_row = next(p for p in subset.json()["players"] if p["name"] == "Early Fantrax")
    espn_subset = next(p for p in subset.json()["players"] if p["name"] == "Early Espn")
    assert fantrax_row["blend"] == 1.5
    assert espn_subset["blend"] == 2.5
    assert fantrax_row["blend_rank"] == 1

    # ids hydrate (rankings) keeps the all-sites blend even if sites is sent
    assert by_ids.status_code == 200
    ids_espn = next(p for p in by_ids.json()["players"] if p["name"] == "Early Espn")
    assert ids_espn["blend"] == 2.0
    index_espn = next(p for p in index.json()["players"] if p["name"] == "Early Espn")
    assert index_espn["blend"] == 2.0


@pytest.mark.asyncio
async def test_get_adp_response_fetches_payload_and_stats_together():
    reset_adp_cache()
    payload = {
        "seasonLabel": "2025-26",
        "updatedAt": "2026-08-21T00:00:00Z",
        "sources": {"espn": "espn-src"},
        "players": [{"espn_id": 1, "name": "A", "adp": {"espn": 1.0}}],
    }
    fetch = AsyncMock(return_value=payload)
    stats = AsyncMock(return_value=("2024-25", {}, "2025-26", {}))
    with (
        patch("app.services.adp_service.fetch_live_adp_payload", fetch),
        patch("app.services.adp_service.load_espn_stat_splits", stats),
        patch("app.services.adp_service.nba_player_catalog.list_all_bios", return_value={}),
    ):
        await get_adp_response()
    fetch.assert_awaited_once()
    stats.assert_awaited_once()


@pytest.mark.asyncio
async def test_get_adp_response_caches_live_payload():
    reset_adp_cache()
    payload = {
        "seasonLabel": "2025-26",
        "updatedAt": "2026-08-21T00:00:00Z",
        "sources": {"espn": "espn-src"},
        "players": [{"espn_id": 1, "name": "A", "adp": {"espn": 1.0}}],
    }
    fetch = AsyncMock(return_value=payload)
    with (
        patch("app.services.adp_service.fetch_live_adp_payload", fetch),
        patch("app.services.adp_service.nba_player_catalog.list_all_bios", return_value={}),
    ):
        first = await get_adp_response()
        second = await get_adp_response()
    assert first is second
    fetch.assert_awaited_once()


@pytest.mark.asyncio
async def test_get_adp_response_keeps_stale_on_refresh_failure():
    reset_adp_cache()
    payload = {
        "seasonLabel": "2025-26",
        "updatedAt": "2026-08-21T00:00:00Z",
        "sources": {"espn": "espn-src"},
        "players": [{"espn_id": 1, "name": "A", "adp": {"espn": 1.0}}],
    }
    fetch = AsyncMock(side_effect=[payload, RuntimeError("down")])
    with (
        patch("app.services.adp_service.fetch_live_adp_payload", fetch),
        patch("app.services.adp_service.nba_player_catalog.list_all_bios", return_value={}),
    ):
        first = await get_adp_response()
        import app.services.adp_service as svc

        svc._cached_at = datetime.now(timezone.utc) - timedelta(hours=2)
        second = await get_adp_response()
    assert second is first
    assert fetch.await_count == 2


def test_adp_route_rankings_view_uses_the_rankings_blend(test_client):
    reset_adp_cache()
    payload = {
        "seasonLabel": "2026-27",
        "updatedAt": "2026-08-25T00:00:00Z",
        "sources": {"espn": "espn-src", "sleeper": "sleeper-src"},
        "providers": [
            {"key": "espn", "label": "ESPN", "has_adp": True, "has_rankings": True},
            {"key": "sleeper", "label": "Sleeper", "has_adp": False, "has_rankings": True},
        ],
        "players": [
            {
                "espn_id": 3112335,
                "name": "Nikola Jokic",
                "positions": ["C"],
                "adp": {"espn": 1.0},
                "ranking": {"espn": 2, "sleeper": 4},
            },
            {
                "espn_id": 4433134,
                "name": "Rankings Only Guy",
                "positions": ["SF"],
                "adp": {},
                "ranking": {"sleeper": 120},
            },
        ],
    }
    with patch("app.services.adp_service.fetch_live_adp_payload", new_callable=AsyncMock, return_value=payload):
        adp_view = test_client.get("/api/adp?metric=adp")
        rank_view = test_client.get("/api/adp?metric=rank&rank_sites=sleeper")

    assert adp_view.status_code == 200
    assert [p["espn_id"] for p in adp_view.json()["players"]] == [3112335]  # ADP view drops it

    body = rank_view.json()
    assert [m["key"] for m in body["providers"]] == ["espn", "sleeper"]
    jokic = next(p for p in body["players"] if p["name"] == "Nikola Jokic")
    assert jokic["ranking_blend"] == 4.0  # sleeper alone, per rank_sites
    assert jokic["blend"] == 1.0  # ADP blend untouched by the rankings selection
    assert jokic["sleeper"]["ranking"] == 4
    rank_only = next(p for p in body["players"] if p["espn_id"] == 4433134)
    assert rank_only["blend"] is None  # rankings-only players are visible on this view
    assert rank_only["ranking_blend"] == 120.0


def test_adp_index_route_exposes_both_blends(test_client):
    reset_adp_cache()
    payload = {
        "seasonLabel": "2026-27",
        "updatedAt": "",
        "sources": {"espn": "espn-src"},
        "players": [
            {
                "espn_id": 3112335,
                "name": "Nikola Jokic",
                "positions": ["C"],
                "adp": {"espn": 1.0},
                "ranking": {"espn": 2},
            }
        ],
    }
    with patch("app.services.adp_service.fetch_live_adp_payload", new_callable=AsyncMock, return_value=payload):
        response = test_client.get("/api/adp/index")
    assert response.status_code == 200
    row = response.json()["players"][0]
    assert row["blend"] == 1.0
    assert row["ranking_blend"] == 2.0


def test_adp_refresh_route_rejects_an_unknown_provider(test_client):
    response = test_client.post("/api/adp/refresh?provider=nonsense")
    assert response.status_code == 400


def test_adp_routes_send_short_cache_headers(test_client):
    fake = AdpResponse(
        season_label="2025-26",
        updated_at="2026-08-21T00:00:00Z",
        players=[],
    )
    with patch("app.routes.adp.get_adp_response_enriched", new_callable=AsyncMock, return_value=fake):
        adp = test_client.get("/api/adp")
    with patch(
        "app.routes.adp.get_adp_index_response",
        new_callable=AsyncMock,
        return_value=AdpIndexResponse(
            season_label="2025-26",
            updated_at="2026-08-21T00:00:00Z",
            players=[],
            total=0,
        ),
    ):
        index = test_client.get("/api/adp/index")
    assert "max-age=60" in adp.headers["cache-control"]
    assert "stale-while-revalidate=600" in adp.headers["cache-control"]
    assert "max-age=60" in index.headers["cache-control"]


def test_adp_can_omit_season_stats(test_client):
    reset_adp_cache()
    payload = {
        "seasonLabel": "2025-26",
        "updatedAt": "2026-08-21T00:00:00Z",
        "sources": {"espn": "espn-src"},
        "players": [{"espn_id": 3112335, "name": "Nikola Jokic", "adp": {"espn": 1.0}}],
    }
    with patch("app.services.adp_service.fetch_live_adp_payload", new_callable=AsyncMock, return_value=payload):
        test_client.get("/api/adp")
    with patch("app.services.adp_service.load_espn_stat_splits", new_callable=AsyncMock) as splits:
        response = test_client.get("/api/adp", params={"include_stats": False})
    splits.assert_not_called()
    assert response.status_code == 200
    player = response.json()["players"][0]
    assert player.get("last_year") is None
    assert player.get("projection") is None

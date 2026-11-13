"""The ``live`` block on the standings-backed responses (plan section 4).

DataProvider is the conftest mock; ``live_state`` stands in for what the real
``get_live_state`` returns: None while LIVE_STANDINGS_ENABLED is off, a
LiveState once it is on."""
from datetime import datetime, timezone

import pytest

from app.services.live_overlay_service import LiveState

AS_OF = datetime(2026, 11, 13, 1, 30, tzinfo=timezone.utc)
UPDATED = datetime(2026, 11, 12, 8, 15, 58, tzinfo=timezone.utc)

LIVE = LiveState(active=True, period=24, as_of=AS_OF, games_total=4, games_live=2, games_final=1,
                 official_updated_at=UPDATED)
IDLE = LiveState(active=False, period=24, as_of=None, games_total=4, games_live=0, games_final=0,
                 official_updated_at=UPDATED, reason="no game started yet")

SEASON_URLS = [
    "/api/rankings",
    "/api/league/summary",
    "/api/analytics/heatmap",
    "/api/teams/1",
]


@pytest.fixture
def provider(mock_data_provider_globally):
    from app.routes.teams import clear_team_detail_cache
    p = mock_data_provider_globally
    p.live_state = None
    p.live_calls.clear()
    clear_team_detail_cache()
    yield p
    p.live_state = None
    p.live_calls.clear()
    clear_team_detail_cache()


@pytest.mark.parametrize("url", SEASON_URLS)
def test_flag_off_response_has_no_live_key_and_uses_official_frames(test_client, provider, url):
    response = test_client.get(url)
    assert response.status_code == 200
    assert "live" not in response.json()
    assert not any(live for _, live in provider.live_calls if _ != 'state')


@pytest.mark.parametrize("url", SEASON_URLS)
def test_live_block_matches_the_contract(test_client, provider, url):
    provider.live_state = LIVE
    response = test_client.get(url)
    assert response.status_code == 200
    assert response.json()["live"] == {
        "active": True,
        "period": 24,
        "as_of": AS_OF.isoformat().replace("+00:00", "Z"),
        "games_total": 4,
        "games_live": 2,
        "games_final": 1,
        "official_updated_at": UPDATED.isoformat().replace("+00:00", "Z"),
    }


@pytest.mark.parametrize("url", SEASON_URLS)
def test_inactive_live_block_is_still_sent_when_the_flag_is_on(test_client, provider, url):
    provider.live_state = IDLE
    live = test_client.get(url).json()["live"]
    assert live["active"] is False
    assert live["as_of"] is None
    assert live["games_total"] == 4


@pytest.mark.parametrize("url", SEASON_URLS)
def test_flag_on_asks_for_live_frames(test_client, provider, url):
    provider.live_state = LIVE
    test_client.get(url)
    assert ('state', True) in provider.live_calls   # averages views ask the scoreboard
    assert any(live for name, live in provider.live_calls if name != 'state')


def test_date_range_rankings_stay_official_without_a_live_block(test_client, provider, monkeypatch):
    """Ranges that end today are a later step: until then they carry no block."""
    from app.services.ranking_service import RankingService

    async def ranged(self, *a, **k):
        from app.models import LeagueRankings
        return LeagueRankings(averages_rankings=[], totals_rankings=[], categories=[],
                              last_updated=datetime.now())
    monkeypatch.setattr(RankingService, "_get_rankings_for_range", ranged)
    provider.live_state = LIVE
    response = test_client.get("/api/rankings?start_date=2026-10-30&end_date=2026-11-01")
    assert response.status_code == 200
    assert "live" not in response.json()


def test_live_block_is_not_memoised_with_the_response(test_client, provider):
    """The block changes with the clock (games tip off, go final) while the
    frames behind it do not, so it is attached after the memo."""
    provider.live_state = LIVE
    first = test_client.get("/api/rankings").json()["live"]
    provider.live_state = LiveState(True, 24, AS_OF, 4, 1, 2, UPDATED)
    second = test_client.get("/api/rankings").json()["live"]
    assert first["games_live"] == 2 and second["games_live"] == 1


class _Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


@pytest.fixture
def clock(monkeypatch):
    import app.routes.teams as teams_route
    c = _Clock()
    monkeypatch.setattr(teams_route.time, "monotonic", c)
    return c


def test_team_detail_cache_keeps_official_responses_for_a_minute(test_client, provider, clock):
    test_client.get("/api/teams/1")
    provider.live_calls.clear()
    clock.now += 59
    test_client.get("/api/teams/1")
    assert provider.live_calls == []   # served from the route cache


def test_team_detail_cache_is_short_while_live_so_a_60s_poll_sees_new_numbers(test_client, provider, clock):
    provider.live_state = LIVE
    test_client.get("/api/teams/1")
    provider.live_calls.clear()
    clock.now += 10
    test_client.get("/api/teams/1")
    assert provider.live_calls == []   # a burst of requests is still absorbed
    clock.now += 15
    provider.live_state = LiveState(True, 24, AS_OF, 4, 1, 2, UPDATED)
    body = test_client.get("/api/teams/1").json()
    assert body["live"]["games_live"] == 1

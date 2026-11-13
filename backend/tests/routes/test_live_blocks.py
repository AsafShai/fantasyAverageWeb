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
    """A range that ends before tonight is stored days only and carries no block."""
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


# --- the team page's "tonight" deltas (PR 4) ---------------------------------

def test_team_detail_has_no_tonight_with_the_flag_off(test_client, provider):
    body = test_client.get("/api/teams/1").json()
    assert "tonight" not in body and "live" not in body
    assert ('starters', True) not in provider.live_calls


def test_team_detail_has_no_tonight_before_tip_off(test_client, provider):
    provider.live_state = IDLE
    assert "tonight" not in test_client.get("/api/teams/1").json()


def test_team_detail_carries_tonight_while_live(test_client, provider):
    provider.live_state = LIVE
    tonight = test_client.get("/api/teams/1").json()["tonight"]
    assert tonight == {"gp": 0, "points": 0.0, "slots": {}, "starters_live": 2}


# --- PR 5: tonight movers, ranges that end today, the race point --------------

from app.services import tonight_changes as tc  # noqa: E402

SNAP = [
    {'team_id': i, 'team_name': n, 'GP': 70, 'FGM': 3000, 'FGA': 6500, 'FG%': 0.46,
     'FTM': 1200, 'FTA': 1600, 'FT%': 0.75, '3PM': 1000, 'REB': 3000, 'AST': 2000,
     'STL': 600, 'BLK': 400, 'PTS': 8000}
    for i, n in [(1, 'Team Alpha'), (2, 'Team Beta'), (3, 'Team Gamma')]
]


@pytest.fixture
def snapshots(provider, monkeypatch):
    calls = []

    async def ranged(start, end, league_id, season_id):
        calls.append((start, end))
        return tc.slate_date(23), tc.slate_date(20), SNAP, SNAP
    monkeypatch.setattr(provider.db_service, "get_snapshots_for_date_range", ranged, raising=False)
    return calls


def _range(url, end):
    return f"{url}?start_date={tc.slate_date(20).isoformat()}&end_date={end.isoformat()}"


@pytest.mark.parametrize("url", ["/api/rankings", "/api/analytics/heatmap"])
def test_range_ending_today_flag_off_is_unchanged(test_client, provider, snapshots, url):
    body = test_client.get(_range(url, tc.slate_date(24))).json()
    assert "live" not in body and "gp_tonight" not in body
    assert body["actual_end_date"] == tc.slate_date(23).isoformat()
    assert ('totals', True) not in provider.live_calls


@pytest.mark.parametrize("url", ["/api/rankings", "/api/analytics/heatmap"])
def test_range_ending_today_takes_the_live_end_while_live(test_client, provider, snapshots, url):
    provider.live_state = LIVE
    body = test_client.get(_range(url, tc.slate_date(24))).json()
    assert body["live"]["active"] is True
    assert body["actual_end_date"] == tc.slate_date(24).isoformat()
    assert ('totals', True) in provider.live_calls


def test_range_ending_today_before_tip_off_is_stored_days_with_a_block(test_client, provider, snapshots):
    provider.live_state = IDLE
    body = test_client.get(_range("/api/rankings", tc.slate_date(24))).json()
    assert body["live"]["active"] is False
    assert body["actual_end_date"] == tc.slate_date(23).isoformat()
    assert ('totals', True) not in provider.live_calls


def test_range_ending_before_tonight_stays_stored_while_live(test_client, provider, snapshots):
    provider.live_state = LIVE
    body = test_client.get(_range("/api/rankings", tc.slate_date(23))).json()
    assert "live" not in body
    assert ('totals', True) not in provider.live_calls


def test_rank_changes_flag_off_has_no_live_key(test_client, provider):
    body = test_client.get("/api/league/rank-changes").json()
    assert "live" not in body
    assert ('rankings', True) not in provider.live_calls


@pytest.mark.parametrize("mode,call", [("averages", ('rankings', True)), ("totals", ('totals', True))])
def test_rank_changes_are_tonight_while_live(test_client, provider, mode, call):
    provider.live_state = LIVE
    body = test_client.get(f"/api/league/rank-changes?mode={mode}").json()
    assert body["live"]["active"] is True
    assert body["previous_period"] == 23 and body["latest_period"] == 24
    assert {t["team_id"] for t in body["teams"]} == {1, 2, 3}
    assert call in provider.live_calls


def test_rank_changes_before_tip_off_are_last_nights_with_a_block(test_client, provider):
    provider.live_state = IDLE
    body = test_client.get("/api/league/rank-changes").json()
    assert body["live"]["active"] is False
    assert ('rankings', True) not in provider.live_calls


def test_today_hub_flag_off_is_unchanged(test_client, provider):
    body = test_client.get("/api/league/today").json()
    assert "live" not in body and "tonight_movers" not in body


def test_today_hub_carries_tonight_movers_while_live(test_client, provider):
    provider.live_state = LIVE
    body = test_client.get("/api/league/today").json()
    assert body["live"]["active"] is True
    assert body["tonight_movers"] == []   # the mock's live frames equal the official ones


def test_today_hub_before_tip_off_has_no_tonight_movers(test_client, provider):
    provider.live_state = IDLE
    body = test_client.get("/api/league/today").json()
    assert body["live"]["active"] is False and "tonight_movers" not in body


def test_summary_carries_official_averages_only_while_live(test_client, provider):
    assert "league_averages_official" not in test_client.get("/api/league/summary").json()
    provider.live_state = IDLE
    assert "league_averages_official" not in test_client.get("/api/league/summary").json()
    provider.live_state = LIVE
    body = test_client.get("/api/league/summary").json()
    assert body["league_averages_official"] == body["league_averages"]


def test_heatmap_gp_tonight_only_while_live(test_client, provider):
    assert "gp_tonight" not in test_client.get("/api/analytics/heatmap").json()
    provider.live_state = LIVE
    body = test_client.get("/api/analytics/heatmap").json()
    assert body["gp_tonight"] == [0] * len(body["teams"])


@pytest.mark.parametrize("source", ["rankings_avg", "rankings_totals", "snapshot", "averages"])
def test_over_time_flag_off_is_unchanged(test_client, provider, source):
    body = test_client.get(f"/api/analytics/over-time?source={source}").json()
    assert "live" not in body and "live_points" not in body


@pytest.mark.parametrize("source", ["rankings_avg", "rankings_totals", "snapshot", "averages"])
def test_over_time_carries_tonights_point_while_live(test_client, provider, source):
    provider.live_state = LIVE
    body = test_client.get(f"/api/analytics/over-time?source={source}&team_ids=1,2").json()
    assert body["live"]["active"] is True
    assert [p["team_id"] for p in body["live_points"]] == [1, 2]
    assert {p["date"] for p in body["live_points"]} == {tc.slate_date(24).isoformat()}


def test_over_time_before_tip_off_has_no_point(test_client, provider):
    provider.live_state = IDLE
    body = test_client.get("/api/analytics/over-time").json()
    assert body["live"]["active"] is False and "live_points" not in body

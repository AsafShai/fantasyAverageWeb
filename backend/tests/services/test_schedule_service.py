import asyncio
import json
from datetime import date
from pathlib import Path

import pytest

import app.services.schedule_service as schedule_module
from app.exceptions import DataSourceError
from app.utils.constants import PRO_TEAM_MAP
from model_stats_inference.espn.games import season_months
from model_stats_inference.espn.teams import TEAM_ID_TO_ABBR, team_id_for_abbr

PRO_TEAM_SCHEDULES_FIXTURE = (
    Path(__file__).resolve().parents[1] / "fixtures" / "pro_team_schedules_2027_trimmed.json"
)


def _load_pro_team_schedules() -> dict:
    return json.loads(PRO_TEAM_SCHEDULES_FIXTURE.read_text())


class _StubProvider:
    def __init__(self, payload):
        self.payload = payload
        self.calls = 0

    async def get_pro_team_schedules(self):
        self.calls += 1
        return self.payload


class _FailingProvider:
    async def get_pro_team_schedules(self):
        raise DataSourceError("ESPN down")


def _event(event_id: str, game_date: str, home_id: int = 1, away_id: int = 2) -> dict:
    return {
        "id": event_id,
        "date": f"{game_date}T00:00:00Z",
        "season": {"type": 2},
        "competitions": [{
            "competitors": [
                {"id": str(home_id), "homeAway": "home", "team": {"id": str(home_id)}},
                {"id": str(away_id), "homeAway": "away", "team": {"id": str(away_id)}},
            ],
        }],
    }


@pytest.fixture(autouse=True)
def clear_schedule_cache():
    schedule_module.invalidate_schedule_cache()
    yield
    schedule_module.invalidate_schedule_cache()


@pytest.fixture(autouse=True)
def fantasy_endpoint_unavailable(monkeypatch):
    """Scoreboard-fallback tests below predate the fantasy endpoint; the
    pro-team tests re-patch get_data_provider themselves."""
    monkeypatch.setattr(schedule_module, "get_data_provider", lambda: _FailingProvider())


@pytest.mark.asyncio
async def test_schedule_fetches_all_months_in_parallel_and_caches(monkeypatch):
    active = 0
    peak_active = 0
    calls: list[str] = []

    async def scoreboard(_client, month):
        nonlocal active, peak_active
        active += 1
        peak_active = max(peak_active, active)
        calls.append(month)
        await asyncio.sleep(0)
        active -= 1
        return {"events": [_event("game-1", "2026-10-21")]} if month == "202610" else {"events": []}

    monkeypatch.setattr(schedule_module.espn_client, "scoreboard_async", scoreboard)

    first = await schedule_module.get_schedule("2026-27")
    second = await schedule_module.get_schedule("2026-27")

    assert calls == ["202610", "202611", "202612", "202701", "202702", "202703", "202704"]
    assert peak_active == 7
    assert first is second
    assert first["teams"][0]["total_games"] == 1
    assert first["teams"][1]["total_games"] == 1


@pytest.mark.asyncio
async def test_schedule_filters_non_countable_games(monkeypatch):
    events = [
        _event("regular", "2026-10-21"),
        {**_event("preseason", "2026-10-20"), "season": {"type": 1}},
    ]

    async def scoreboard(_client, month):
        return {"events": events} if month == "202610" else {"events": []}

    monkeypatch.setattr(schedule_module.espn_client, "scoreboard_async", scoreboard)

    payload = await schedule_module.get_schedule("2026-27")

    assert payload["published_games_min"] == 0
    assert payload["teams"][0]["total_games"] == 1
    assert len(payload["calendar_days"]) == 1
    assert payload["calendar_days"][0]["slate_size"] == 1


@pytest.mark.asyncio
async def test_schedule_cache_expires_after_24_hours(monkeypatch):
    calls = 0

    async def scoreboard(_client, _month):
        nonlocal calls
        calls += 1
        return {"events": []}

    clock = 100.0
    monkeypatch.setattr(schedule_module.espn_client, "scoreboard_async", scoreboard)
    monkeypatch.setattr(schedule_module.time, "monotonic", lambda: clock)

    await schedule_module.get_schedule("2026-27")
    await schedule_module.get_schedule("2026-27")
    assert calls == 7

    clock += schedule_module.CACHE_TTL_SECONDS + 1
    await schedule_module.get_schedule("2026-27")
    assert calls == 14


def test_schedule_rest_days_are_calendar_days_between_games():
    games_by_team = {team_id: [] for team_id in schedule_module.TEAM_IDS}
    games_by_team[1] = [
        schedule_module.ScheduledGame("g1", date(2026, 10, 1), 2, True),
        schedule_module.ScheduledGame("g2", date(2026, 10, 2), 2, True),
        schedule_module.ScheduledGame("g3", date(2026, 10, 5), 2, True),
    ]

    payload = schedule_module._build_payload("2026-27", games_by_team)
    team = next(team for team in payload["teams"] if team["team_id"] == 1)

    assert [game["rest_days"] for game in team["games"]] == [None, 0, 2]
    assert team["b2b_count"] == 1
    assert team["avg_rest_days"] == 1.0


def test_pro_team_schedules_extracts_every_team_side_once():
    games_by_team = schedule_module._games_from_pro_team_schedules(_load_pro_team_schedules())

    assert len(games_by_team[18]) == 3
    assert len(games_by_team[20]) == 3
    assert len(games_by_team[2]) == 3
    assert [game.game_id for game in games_by_team[18]] == ["401909089", "401909095", "401909863"]


def test_pro_team_schedules_registers_opponents_absent_from_the_payload():
    games_by_team = schedule_module._games_from_pro_team_schedules(_load_pro_team_schedules())

    assert len(games_by_team[8]) == 1
    assert games_by_team[8][0].opponent_id == 2
    assert games_by_team[8][0].is_home is True


def test_pro_team_schedules_sets_home_and_away_from_pro_team_ids():
    games_by_team = schedule_module._games_from_pro_team_schedules(_load_pro_team_schedules())

    opener_home = next(g for g in games_by_team[18] if g.game_id == "401909089")
    opener_away = next(g for g in games_by_team[20] if g.game_id == "401909089")

    assert opener_home.is_home is True
    assert opener_home.opponent_id == 20
    assert opener_away.is_home is False
    assert opener_away.opponent_id == 18


def test_pro_team_schedules_dedupes_a_game_listed_under_both_teams():
    games_by_team = schedule_module._games_from_pro_team_schedules(_load_pro_team_schedules())

    shared = [g for g in games_by_team[2] if g.game_id == "401909095"]
    assert len(shared) == 1
    assert shared[0].is_home is True
    assert shared[0].opponent_id == 18


def test_pro_team_schedules_converts_epoch_ms_to_eastern_date():
    games_by_team = schedule_module._games_from_pro_team_schedules(_load_pro_team_schedules())

    assert games_by_team[18][0].game_date == date(2026, 10, 20)


def test_pro_team_schedules_uses_eastern_not_utc_for_late_tipoffs():
    payload = {"settings": {"proTeams": [{
        "id": 18,
        "abbrev": "NY",
        "proGamesByScoringPeriod": {"1": [{
            "id": 1,
            "date": 1792506600000,
            "homeProTeamId": 18,
            "awayProTeamId": 2,
            "scoringPeriodId": 1,
        }]},
    }]}}

    games_by_team = schedule_module._games_from_pro_team_schedules(payload)

    assert games_by_team[18][0].game_date == date(2026, 10, 20)


def test_pro_team_schedules_filters_non_positive_scoring_periods():
    payload = {"settings": {"proTeams": [{
        "id": 18,
        "abbrev": "NY",
        "proGamesByScoringPeriod": {
            "0": [{"id": 1, "date": 1792537200000, "homeProTeamId": 18,
                   "awayProTeamId": 2, "scoringPeriodId": 0}],
            "1": [{"id": 2, "date": 1792537200000, "homeProTeamId": 18,
                   "awayProTeamId": 2, "scoringPeriodId": 1}],
        },
    }]}}

    games_by_team = schedule_module._games_from_pro_team_schedules(payload)

    assert [g.game_id for g in games_by_team[18]] == ["2"]


def test_pro_team_schedules_skips_free_agent_and_unknown_team_ids():
    payload = {"settings": {"proTeams": [
        {"id": 0, "abbrev": "FA", "proGamesByScoringPeriod": {}},
        {"id": 18, "abbrev": "NY", "proGamesByScoringPeriod": {"1": [{
            "id": 1, "date": 1792537200000, "homeProTeamId": 18,
            "awayProTeamId": 99, "scoringPeriodId": 1,
        }]}},
    ]}}

    games_by_team = schedule_module._games_from_pro_team_schedules(payload)

    assert set(games_by_team) == set(schedule_module.TEAM_IDS)
    assert all(not games for games in games_by_team.values())


def test_pro_team_schedules_handles_empty_payload():
    assert schedule_module._games_from_pro_team_schedules({}) == {
        team_id: [] for team_id in schedule_module.TEAM_IDS
    }


def test_pro_team_ids_agree_with_pro_team_map():
    payload = _load_pro_team_schedules()

    for team in payload["settings"]["proTeams"]:
        assert PRO_TEAM_MAP[team["id"]] == TEAM_ID_TO_ABBR[team["id"]]
        assert team_id_for_abbr(team["abbrev"]) == team["id"]


def test_season_start_is_the_earliest_period_one_game():
    payload = _load_pro_team_schedules()

    assert schedule_module.season_start_from_pro_team_schedules(payload) == date(2026, 10, 20)


def test_season_start_is_none_without_period_one_games():
    payload = {"settings": {"proTeams": [{
        "id": 18, "abbrev": "NY",
        "proGamesByScoringPeriod": {"4": [{
            "id": 1, "date": 1792537200000, "homeProTeamId": 18,
            "awayProTeamId": 2, "scoringPeriodId": 4,
        }]},
    }]}}

    assert schedule_module.season_start_from_pro_team_schedules(payload) is None


@pytest.mark.asyncio
async def test_get_schedule_prefers_pro_team_schedules(monkeypatch):
    scoreboard_calls: list[str] = []

    async def scoreboard(_client, month):
        scoreboard_calls.append(month)
        return {"events": []}

    monkeypatch.setattr(schedule_module.espn_client, "scoreboard_async", scoreboard)
    monkeypatch.setattr(
        schedule_module, "get_data_provider", lambda: _StubProvider(_load_pro_team_schedules())
    )

    built = await schedule_module.get_schedule(schedule_module.season_label())

    assert scoreboard_calls == []
    assert set(built) == {
        "season", "high_volume_threshold", "calendar_days", "teams",
        "published_games_min", "published_games_max",
    }
    knicks = next(t for t in built["teams"] if t["team_id"] == 18)
    assert knicks["total_games"] == 3
    assert knicks["abbreviation"] == "NYK"
    assert knicks["games"][0]["opponent_abbreviation"] == "PHL"


@pytest.mark.asyncio
async def test_get_schedule_falls_back_to_scoreboards_when_fantasy_endpoint_fails(monkeypatch):
    opening_month = season_months(schedule_module.season_label())[0]

    async def scoreboard(_client, month):
        return {"events": [_event("game-1", "2025-10-21")]} if month == opening_month else {"events": []}

    monkeypatch.setattr(schedule_module.espn_client, "scoreboard_async", scoreboard)
    monkeypatch.setattr(schedule_module, "get_data_provider", lambda: _FailingProvider())

    built = await schedule_module.get_schedule(schedule_module.season_label())

    assert built["teams"][0]["total_games"] == 1


@pytest.mark.asyncio
async def test_get_schedule_falls_back_when_pro_team_schedules_are_empty(monkeypatch):
    opening_month = season_months(schedule_module.season_label())[0]

    async def scoreboard(_client, month):
        return {"events": [_event("game-1", "2025-10-21")]} if month == opening_month else {"events": []}

    monkeypatch.setattr(schedule_module.espn_client, "scoreboard_async", scoreboard)
    monkeypatch.setattr(
        schedule_module, "get_data_provider", lambda: _StubProvider({"settings": {"proTeams": []}})
    )

    built = await schedule_module.get_schedule(schedule_module.season_label())

    assert built["teams"][0]["total_games"] == 1


@pytest.mark.asyncio
async def test_get_schedule_uses_scoreboards_for_a_non_configured_season(monkeypatch):
    calls: list[str] = []

    async def scoreboard(_client, month):
        calls.append(month)
        return {"events": []}

    monkeypatch.setattr(schedule_module.espn_client, "scoreboard_async", scoreboard)
    monkeypatch.setattr(
        schedule_module, "get_data_provider", lambda: _StubProvider(_load_pro_team_schedules())
    )

    await schedule_module.get_schedule("2019-20")

    assert calls == ["201910", "201911", "201912", "202001", "202002", "202003", "202004"]


@pytest.mark.asyncio
async def test_season_start_date_reads_the_provider_payload(monkeypatch):
    monkeypatch.setattr(
        schedule_module, "get_data_provider", lambda: _StubProvider(_load_pro_team_schedules())
    )

    assert await schedule_module.get_season_start_date() == date(2026, 10, 20)


@pytest.mark.asyncio
async def test_season_start_date_is_none_when_the_endpoint_fails(monkeypatch):
    monkeypatch.setattr(schedule_module, "get_data_provider", lambda: _FailingProvider())

    assert await schedule_module.get_season_start_date() is None

import asyncio
from datetime import date

import pytest

import app.services.schedule_service as schedule_module


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

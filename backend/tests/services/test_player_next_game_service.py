from datetime import date, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from zoneinfo import ZoneInfo

import pytest

from app.services import player_next_game_service as pngs

ET = ZoneInfo('America/New_York')
LAL, CHA, BOS = 13, 30, 2


def _today() -> date:
    return datetime.now(ET).date()


def _game(game_id: int, day: date, home: int, away: int) -> dict:
    tip = datetime(day.year, day.month, day.day, 19, 30, tzinfo=ET)
    return {'id': game_id, 'date': int(tip.timestamp() * 1000), 'homeProTeamId': home,
            'awayProTeamId': away, 'scoringPeriodId': 30}


def _payload(*games: dict) -> dict:
    by_team: dict[int, list] = {}
    for g in games:
        by_team.setdefault(g['homeProTeamId'], []).append(g)
        by_team.setdefault(g['awayProTeamId'], []).append(g)
    return {'settings': {'proTeams': [
        {'id': tid, 'proGamesByScoringPeriod': {'30': gs}} for tid, gs in by_team.items()
    ]}}


@pytest.fixture
def svc(monkeypatch):
    service = pngs.PlayerNextGameService.__new__(pngs.PlayerNextGameService)
    service._matchups = MagicMock()
    service._matchups.get_games_today = AsyncMock(return_value={})
    service._matchups.get_schedule_date = MagicMock(return_value=_today().isoformat())
    service._matchups.get_upcoming_game_dates = AsyncMock(return_value=[])
    provider = MagicMock()
    provider.get_pro_team_schedules = AsyncMock()
    monkeypatch.setattr(pngs, 'get_data_provider', lambda: provider)
    return service, provider


@pytest.mark.asyncio
async def test_next_game_comes_from_the_season_schedule_not_day_scoreboards(svc):
    service, provider = svc
    today = _today()
    provider.get_pro_team_schedules.return_value = _payload(
        _game(1, today - timedelta(days=1), LAL, CHA),   # already played
        _game(2, today + timedelta(days=2), CHA, LAL),   # next: away at CHA
        _game(3, today + timedelta(days=4), LAL, BOS),
    )

    found = await service._find_next_game('LAL')

    assert found == ((today + timedelta(days=2)).isoformat(), 'CHA', False)
    service._matchups.get_upcoming_game_dates.assert_not_awaited()


@pytest.mark.asyncio
async def test_default_slate_game_is_used_without_the_schedule(svc):
    service, provider = svc
    service._matchups.get_games_today.return_value = {'LAL': SimpleNamespace(opponent='CHA', is_home=True)}

    found = await service._find_next_game('LAL')

    assert found == (_today().isoformat(), 'CHA', True)
    provider.get_pro_team_schedules.assert_not_awaited()


@pytest.mark.asyncio
async def test_schedule_skips_the_default_slate_day_and_beyond_the_window(svc):
    service, provider = svc
    today = _today()
    tomorrow = today + timedelta(days=1)
    service._matchups.get_schedule_date.return_value = tomorrow.isoformat()
    provider.get_pro_team_schedules.return_value = _payload(
        _game(1, tomorrow, LAL, CHA),                     # the default slate: checked by the caller
        _game(2, today + timedelta(days=20), LAL, BOS),   # past the lookahead window
    )

    assert await service._find_next_game('LAL') is None


@pytest.mark.asyncio
async def test_falls_back_to_scoreboards_when_the_schedule_is_unavailable(svc):
    service, provider = svc
    day = (_today() + timedelta(days=3)).isoformat()
    provider.get_pro_team_schedules.side_effect = RuntimeError('ESPN down')
    service._matchups.get_upcoming_game_dates.return_value = [day]
    service._matchups.get_games_today.side_effect = [
        {},                                                        # default slate
        {'LAL': SimpleNamespace(opponent='BOS', is_home=False)},   # that day
    ]

    assert await service._find_next_game('LAL') == (day, 'BOS', False)

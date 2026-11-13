"""The team page's Daily roster on a live night (plan section 7 step 3) and
the game result on every player line (Asaf, 2026-11-13: final results always,
live scores and clocks only with LIVE_STANDINGS_ENABLED on)."""
import json
from datetime import date, datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.config import settings
from app.services import live_overlay_service
from app.services import roster_day_service as svc
from app.services.live_overlay_service import LiveState
from tests.services.test_live_overlay import GAME_A, GAME_B, _line, _payload
from tests.services.test_roster_day_service import _FakeDB, _entry

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"
SCHEDULE = json.loads((FIXTURES / "pro_team_schedules_2027_periods_22_25.json").read_text())
SEASON_START = date(2026, 10, 20)        # period 24 = Thu Nov 12
TIP = 1_794_528_000_000                   # games A and B, 7 PM ET Nov 12
MIN = 60_000
PHI, TOR, DET, MIN_T, NOGAME, DAL = 20, 28, 8, 16, 5, 6

LINE_A = {"40": 31, "13": 5, "14": 11, "15": 2, "16": 4, "6": 8, "3": 4, "2": 3, "1": 1, "0": 12, "42": 1}
LINE_B = {"40": 22, "13": 3, "14": 8, "15": 1, "16": 2, "6": 5, "3": 3, "2": 2, "1": 1, "0": 7, "42": 1}


def _mroster():
    """mRoster for period 24 as fetched a few minutes ago (no lines yet)."""
    return {"seasonId": settings.season_id, "teams": [{"id": 1, "roster": {"entries": [
        _entry(11, "Final Guy", 0, PHI, None, 24),
        _entry(12, "Live Guy", 1, DET, None, 24),
        _entry(13, "Later Guy", 2, MIN_T, None, 24),
        _entry(14, "Bench Guy", 12, TOR, None, 24),
        _entry(15, "Off Guy", 3, NOGAME, None, 24),
    ]}}]}


def _raw_entry(pid, slot, pro, *lines):
    return {"lineupSlotId": slot, "playerId": pid, "playerPoolEntry": {"player": {
        "id": pid, "fullName": f"P{pid}", "proTeamId": pro, "stats": list(lines)}}}


def _league_raw():
    """The 30 s league payload: lines so far, and a player added since mRoster."""
    return _payload(period=24, entries_by_team={1: [
        _raw_entry(11, 0, PHI, _line(GAME_A, 24, LINE_A)),
        _raw_entry(12, 1, DET, _line(GAME_B, 24, LINE_B)),
        _raw_entry(13, 2, MIN_T),
        _raw_entry(14, 12, TOR, _line(GAME_A, 24, {})),
        _raw_entry(15, 3, NOGAME),
        _raw_entry(16, 11, DAL),
    ]})


def _side(abbr, score, winner=False):
    return {"abbreviation": abbr, "score": score, "winner": winner}


BOARD = {"games": [
    {"game_id": GAME_A, "status": "final", "status_detail": "Final", "start_time": "2026-11-13T00:00Z",
     "away": _side("TOR", 104), "home": _side("PHI", 110, winner=True)},
    {"game_id": GAME_B, "status": "live", "status_detail": "Q3 4:12", "start_time": "2026-11-13T00:00Z",
     "away": _side("DET", 78), "home": _side("WSH", 71)},
]}


def _provider(live_state):
    provider = MagicMock()
    provider.get_team_names = AsyncMock(return_value=[{"team_id": 1, "team_name": "A"}])
    provider.get_players_directory = AsyncMock(return_value={})
    provider.get_pro_team_schedules = AsyncMock(return_value=SCHEDULE)
    provider.get_live_state = AsyncMock(return_value=live_state)
    provider.cached_totals_raw = MagicMock(return_value=_league_raw())
    provider.live.known_final = MagicMock(return_value=frozenset({GAME_A}))
    return provider


async def _day(monkeypatch, *, flag, now_ms, live_state=None, day=None):
    monkeypatch.setattr(settings, "live_standings_enabled", flag)
    service = svc.RosterDayService()
    service._db = _FakeDB()
    provider = _provider(live_state)
    scoreboard = AsyncMock(return_value=BOARD)

    async def fake_get(params):
        return _mroster() if dict(params)["view"] == "mRoster" else {"transactions": []}

    with patch.object(svc, "get_data_provider", return_value=provider), \
         patch.object(svc.schedule_service, "get_season_start_date", AsyncMock(return_value=SEASON_START)), \
         patch.object(svc, "eastern_today", return_value=date(2026, 11, 13)), \
         patch.object(svc.box_score_service, "scoreboard_for", scoreboard), \
         patch.object(live_overlay_service, "_now_ms", lambda: now_ms), \
         patch.object(service, "_get", side_effect=fake_get):
        result = await service.get_roster_day(1, day)
    return result, scoreboard, provider


LIVE = LiveState(True, 24, datetime(2026, 11, 13, 1, 30, tzinfo=timezone.utc), 4, 2, 1,
                 datetime(2026, 11, 12, 8, 15, tzinfo=timezone.utc))


@pytest.mark.asyncio
async def test_flag_on_today_is_espns_period_even_after_midnight_eastern(monkeypatch):
    day, _, _ = await _day(monkeypatch, flag=True, now_ms=TIP + 30 * MIN, live_state=LIVE)
    assert day.date == date(2026, 11, 12) and day.is_today and day.scoring_period_id == 24
    assert day.last_date == date(2026, 11, 12)
    assert day.live is not None and day.live.active and day.live.games_live == 2


@pytest.mark.asyncio
async def test_flag_on_lines_statuses_and_games(monkeypatch):
    day, scoreboard, _ = await _day(monkeypatch, flag=True, now_ms=TIP + 30 * MIN, live_state=LIVE)
    by_id = {p.player_id: p for p in day.players}
    assert set(by_id) == {11, 12, 13, 14, 15, 16}       # roster from the 30 s payload

    final = by_id[11]
    assert final.status == "played" and final.stats.pts == 12
    assert (final.game.status, final.game.team_score, final.game.opp_score, final.game.won) == ("final", 110, 104, True)

    live = by_id[12]
    assert live.status == "live" and live.stats.pts == 7 and live.stats.minutes == 22
    assert (live.game.status, live.game.detail, live.game.team_score, live.game.opp_score) == ("live", "Q3 4:12", 78, 71)
    assert live.game.won is None

    later = by_id[13]
    assert later.status == "scheduled" and later.stats is None
    assert later.game.status == "scheduled"
    assert later.game.start_time == datetime(2026, 11, 13, 1, 0, tzinfo=timezone.utc)

    assert by_id[14].status == "dnp" and by_id[14].lineup_slot == "BE"
    assert by_id[15].status == "no_game" and by_id[15].game is None
    assert by_id[16].lineup_slot == "UTIL" and by_id[16].player_name == "P16"
    scoreboard.assert_awaited_once()                     # one shared request for the day


@pytest.mark.asyncio
async def test_flag_on_before_tip_off_asks_no_scoreboard(monkeypatch):
    idle = LiveState(False, 24, None, 4, 0, 0, None, "no game started yet")
    day, scoreboard, _ = await _day(monkeypatch, flag=True, now_ms=TIP - 60 * MIN, live_state=idle)
    scoreboard.assert_not_awaited()
    assert day.live is not None and day.live.active is False
    # The live payload's lines are only there once games tip; nothing shown as live.
    assert {p.status for p in day.players} <= {"scheduled", "no_game", "live", "played", "dnp"}


@pytest.mark.asyncio
async def test_flag_off_shows_final_results_only(monkeypatch):
    # Flag off: Eastern today is Nov 13, so Nov 12 is a past day, as before.
    day, _, _ = await _day(monkeypatch, flag=False, now_ms=TIP + 3 * 60 * MIN, day=date(2026, 11, 12))
    by_id = {p.player_id: p for p in day.players}
    assert day.is_today is False and day.live is None
    assert by_id[11].game.status == "final" and by_id[11].game.won is True
    assert by_id[12].game is None                          # live game: no score with the flag off
    assert by_id[13].game is None
    body = day.model_dump(mode="json")
    assert "live" not in body
    assert "game" not in next(p for p in body["players"] if p["player_id"] == 12)
    assert {p["player_id"] for p in body["players"]} == {11, 12, 13, 14, 15}   # mRoster, as before


@pytest.mark.asyncio
async def test_flag_off_waits_until_a_game_could_have_ended(monkeypatch):
    _, scoreboard, _ = await _day(monkeypatch, flag=False, now_ms=TIP + 60 * MIN, day=date(2026, 11, 12))
    scoreboard.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_final_game_is_not_asked_about_again(monkeypatch):
    monkeypatch.setattr(settings, "live_standings_enabled", False)
    service = svc.RosterDayService()
    games = {GAME_A: TIP}
    scoreboard = AsyncMock(return_value=BOARD)
    with patch.object(svc.box_score_service, "scoreboard_for", scoreboard):
        first = await service._scoreboard_games(date(2026, 11, 12), games, False, TIP + 3 * 60 * MIN)
        again = await service._scoreboard_games(date(2026, 11, 12), games, False, TIP + 3 * 60 * MIN)
    assert first[GAME_A]["status"] == "final" and again == first
    scoreboard.assert_awaited_once()


@pytest.mark.asyncio
async def test_scoreboard_failure_leaves_results_out(monkeypatch):
    service = svc.RosterDayService()
    with patch.object(svc.box_score_service, "scoreboard_for", AsyncMock(side_effect=RuntimeError("down"))):
        assert await service._scoreboard_games(date(2026, 11, 12), {GAME_A: TIP}, False, TIP + 3 * 60 * MIN) == {}

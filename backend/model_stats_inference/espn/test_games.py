from datetime import date
from unittest.mock import patch

from . import games
from .client import EspnUnavailableError


def _event(event_id: int, home_id: int, away_id: int, completed: bool = True) -> dict:
    return {
        "id": str(event_id),
        "date": "2026-01-15T19:00Z",
        "season": {"type": games.REGULAR_SEASON_TYPE},
        "status": {"type": {"completed": completed}},
        "competitions": [{
            "competitors": [
                {"team": {"id": str(home_id)}},
                {"team": {"id": str(away_id)}},
            ],
            "notes": [],
        }],
    }


def _good_rows(event_id: int) -> tuple[list[dict], list[dict]]:
    return (
        [{"PLAYER_ID": 1, "GAME_ID": str(event_id)}],
        [{"TEAM_ID": 13, "GAME_ID": str(event_id)}, {"TEAM_ID": 30, "GAME_ID": str(event_id)}],
    )


def test_fetch_day_skips_one_bad_summary_keeps_the_rest(monkeypatch):
    """A single malformed/unreachable game summary must not sink the whole
    night — the other games' rows still come back, and the resulting short
    team_games count is what downstream (nightly.fetch_night) relies on to
    mark the night incomplete and retry, rather than losing it silently."""
    events = [_event(1, 13, 30), _event(2, 18, 9), _event(3, 6, 7)]
    monkeypatch.setattr(games.client, "scoreboard", lambda dates: {"events": events})
    monkeypatch.setattr(games.client, "game_summary", lambda event_id: {})

    def fake_build(event, summary):
        if event["id"] == "2":
            raise KeyError("boxscore")
        return _good_rows(int(event["id"]))

    with patch.object(games, "build_game_rows", side_effect=fake_build):
        day = games.fetch_day(date(2026, 1, 15))

    assert day.expected_games == 3
    assert day.all_final is True
    # event 2's rows are absent; events 1 and 3 still made it through
    assert set(day.players["GAME_ID"]) == {"1", "3"}
    assert len(day.teams) == 4  # 2 games x 2 teams, not 3 x 2


def test_fetch_day_skips_espn_unavailable_summary(monkeypatch):
    """A transient ESPN failure fetching one game's summary is the same
    failure mode as a malformed payload — must not abort the whole night."""
    events = [_event(1, 13, 30), _event(2, 18, 9)]
    monkeypatch.setattr(games.client, "scoreboard", lambda dates: {"events": events})
    monkeypatch.setattr(games.client, "game_summary", lambda event_id: {})

    def fake_build(event, summary):
        if event["id"] == "1":
            raise EspnUnavailableError("boom")
        return _good_rows(int(event["id"]))

    with patch.object(games, "build_game_rows", side_effect=fake_build):
        day = games.fetch_day(date(2026, 1, 15))

    assert set(day.players["GAME_ID"]) == {"2"}
    assert len(day.teams) == 2


def test_fetch_day_all_games_parse_cleanly(monkeypatch):
    events = [_event(1, 13, 30), _event(2, 18, 9)]
    monkeypatch.setattr(games.client, "scoreboard", lambda dates: {"events": events})
    monkeypatch.setattr(games.client, "game_summary", lambda event_id: {})

    with patch.object(games, "build_game_rows", side_effect=lambda e, s: _good_rows(int(e["id"]))):
        day = games.fetch_day(date(2026, 1, 15))

    assert day.expected_games == 2
    assert len(day.players) == 2
    assert len(day.teams) == 4

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


# --- called-off games and the night's last tip-off ---------------------------

def _status(event: dict, name: str, completed: bool = False) -> dict:
    event["status"] = {"type": {"name": name, "completed": completed, "state": "post"}}
    return event


def _at(event: dict, iso: str) -> dict:
    event["date"] = iso
    return event


def test_postponed_and_canceled_games_are_not_waited_for(monkeypatch):
    """ESPN leaves a called-off game on its original date, never completed.
    Counting it would keep the night incomplete forever and, through the
    catch-up's stop-at-first-incomplete rule, every night after it."""
    events = [
        _event(1, 13, 30),
        _status(_event(2, 18, 9), "STATUS_POSTPONED"),
        _status(_event(3, 6, 7), "STATUS_CANCELED"),
    ]
    monkeypatch.setattr(games.client, "scoreboard", lambda dates: {"events": events})
    monkeypatch.setattr(games.client, "game_summary", lambda event_id: {})
    with patch.object(games, "build_game_rows", side_effect=lambda e, s: _good_rows(int(e["id"]))):
        day = games.fetch_day(date(2026, 1, 15))
    assert day.expected_games == 1
    assert day.all_final is True
    assert len(day.teams) == 2
    assert day.total_events == 3


def test_a_night_whose_every_game_was_called_off_has_no_expected_games(monkeypatch):
    events = [_status(_event(1, 13, 30), "STATUS_POSTPONED")]
    monkeypatch.setattr(games.client, "scoreboard", lambda dates: {"events": events})
    day = games.fetch_day(date(2026, 1, 15))
    assert (day.expected_games, day.all_final, day.total_events) == (0, True, 1)


def test_a_game_in_progress_or_suspended_is_still_waited_for(monkeypatch):
    """Only postponed / canceled are dropped: anything else not final keeps the
    night open, as before."""
    events = [_event(1, 13, 30), _status(_event(2, 18, 9), "STATUS_SUSPENDED")]
    monkeypatch.setattr(games.client, "scoreboard", lambda dates: {"events": events})
    monkeypatch.setattr(games.client, "game_summary", lambda event_id: {})
    with patch.object(games, "build_game_rows", side_effect=lambda e, s: _good_rows(int(e["id"]))):
        day = games.fetch_day(date(2026, 1, 15))
    assert day.expected_games == 2 and day.all_final is False


def test_status_without_a_name_is_not_called_off():
    assert games.is_called_off(_event(1, 13, 30)) is False
    assert games.is_called_off({}) is False


def test_last_tip_is_the_latest_expected_game():
    from datetime import datetime, timezone
    sb = {"events": [
        _at(_event(1, 13, 30), "2026-11-20T00:00Z"),
        _at(_event(2, 18, 9), "2026-11-20T03:30Z"),
        _at(_event(3, 6, 7), "2026-11-20T01:00Z"),
    ]}
    assert games.last_tip(sb) == datetime(2026, 11, 20, 3, 30, tzinfo=timezone.utc)


def test_last_tip_ignores_called_off_and_uncountable_games():
    """A postponed late game, an All-Star exhibition or the NBA Cup final must
    not push the night's first check later."""
    from datetime import datetime, timezone
    cup_final = _at(_event(4, 13, 30), "2026-11-20T05:00Z")
    cup_final["competitions"][0]["notes"] = [{"headline": "NBA Cup Championship"}]
    preseason = _at(_event(5, 13, 30), "2026-11-20T06:00Z")
    preseason["season"] = {"type": 1}
    sb = {"events": [
        _at(_event(1, 13, 30), "2026-11-20T00:00Z"),
        _status(_at(_event(2, 18, 9), "2026-11-20T04:00Z"), "STATUS_POSTPONED"),
        cup_final,
        preseason,
    ]}
    assert games.last_tip(sb) == datetime(2026, 11, 20, 0, 0, tzinfo=timezone.utc)


def test_last_tip_none_without_games_and_skips_unparseable_dates():
    from datetime import datetime, timezone
    assert games.last_tip({"events": []}) is None
    assert games.last_tip({}) is None
    bad = _at(_event(1, 13, 30), "not a date")
    good = _at(_event(2, 18, 9), "2026-11-20T02:00Z")
    assert games.last_tip({"events": [bad, good]}) == datetime(2026, 11, 20, 2, tzinfo=timezone.utc)
    missing = _event(3, 6, 7)
    del missing["date"]
    assert games.last_tip({"events": [missing]}) is None

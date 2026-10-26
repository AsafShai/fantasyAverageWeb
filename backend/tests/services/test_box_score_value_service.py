from datetime import date
from unittest.mock import AsyncMock, patch

import pytest

from app.services import box_score_value_service as svc
from app.services.box_score_value_service import category_stats, slate_values, stat_line


def _player(pid, name, minutes="30", pts="10", fg="4-8", fg3="1-3", ft="1-2", reb="5", ast="3",
            stl="1", blk="0", tov="2"):
    return {
        "player_id": pid, "name": name, "position": "G", "ejected": False,
        "min": minutes, "pts": pts, "fg": fg, "fg3": fg3, "ft": ft, "reb": reb, "ast": ast,
        "tov": tov, "stl": stl, "blk": blk, "oreb": "1", "dreb": "4", "pf": "2", "plus_minus": "+3",
    }


def _box(game_id, status, away_players, home_players):
    def team(abbr, players):
        return {"abbreviation": abbr, "logo": "", "starters": players, "bench": [], "did_not_play": []}
    return {"game_id": game_id, "status": status, "away": team("LAL", away_players), "home": team("UTAH", home_players)}


def test_stat_line_parses_made_attempted_and_keeps_zero_minute_lines():
    line = stat_line(_player("1", "A", fg="17-30", fg3="8-18", ft="10-11", pts="52"))
    assert line["FGM"] == 17 and line["FGA"] == 30
    assert line["3PM"] == 8 and line["FTA"] == 11 and line["PTS"] == 52
    blank = stat_line(_player("2", "B", minutes="0", pts="", fg="", fg3="", ft="", reb="", ast="", stl="", blk="", tov=""))
    assert blank["MIN"] == 0 and blank["PTS"] == 0 and blank["FGA"] == 0


def test_category_stats_key_the_line_by_category_code():
    stats = category_stats(stat_line(_player("1", "A", pts="52", fg="17-30", fg3="8-18", ft="10-11", tov="4")))
    assert stats["PTS"] == 52 and stats["3PM"] == 8 and stats["TO"] == 4 and stats["PPG"] == 52
    assert stats["FG%"] == pytest.approx(17 / 30) and stats["FT%"] == pytest.approx(10 / 11)
    assert stats["MIN"] == 30
    # No attempts: the percentage is 0, as in the players list.
    assert category_stats(stat_line(_player("2", "B", ft="0-0")))["FT%"] == 0


@pytest.mark.asyncio
async def test_slate_values_tags_owner_on_that_night_and_free_agents():
    svc.clear_box_score_value_cache()
    board = {"date": "2026-10-25", "games": [
        {"game_id": "100", "status": "final"},
        {"game_id": "200", "status": "final"},
    ]}
    boxes = {
        "100": _box("100", "final", [_player("1", "Luka", pts="52", fg="17-30")], [_player("2", "Bench Guy", pts="2")]),
        "200": _box("200", "final", [_player("3", "Quiet", minutes="0", pts="0", fg="0-0", fg3="0-0", ft="0-0", reb="0", ast="0", stl="0", tov="0")], []),
    }
    with patch.object(svc, "scoreboard_for", AsyncMock(return_value=board)), \
         patch.object(svc, "boxscore_for", AsyncMock(side_effect=lambda gid: boxes[gid])), \
         patch.object(svc, "fantasy_roster_for", AsyncMock(return_value={1: {"team_id": 7, "slot": "PG"}})), \
         patch.object(svc, "_league_categories", AsyncMock(return_value=(["PTS", "FG%"], set()))), \
         patch.object(svc, "_fantasy_teams", AsyncMock(return_value=({7: "TTP"}, {7: "Trust the process"}))):
        result = await slate_values(date(2026, 10, 25))
    assert result["complete"] is True
    assert result["categories"] == ["PTS", "FG%"] and result["reverse_categories"] == []
    # Every non-DNP line, 0-minute ones too; the Z is the browser's to compute.
    luka, bench, quiet = result["players"]
    assert [luka["name"], bench["name"], quiet["name"]] == ["Luka", "Bench Guy", "Quiet"]
    assert "z" not in luka
    assert luka["stats"]["PTS"] == 52 and quiet["stats"]["MIN"] == 0
    assert luka["fantasy_team"] == "TTP" and luka["fantasy_team_name"] == "Trust the process"
    assert bench["fantasy_team"] is None
    assert luka["opponent_abbr"] == "UTAH" and bench["is_home"] is True


@pytest.mark.asyncio
async def test_slate_values_is_incomplete_while_a_game_is_live():
    svc.clear_box_score_value_cache()
    board = {"date": "2026-10-25", "games": [
        {"game_id": "100", "status": "final"},
        {"game_id": "200", "status": "scheduled"},
    ]}
    with patch.object(svc, "scoreboard_for", AsyncMock(return_value=board)), \
         patch.object(svc, "boxscore_for", AsyncMock(return_value=_box("100", "final", [_player("1", "A")], []))) as box, \
         patch.object(svc, "fantasy_roster_for", AsyncMock(return_value={})), \
         patch.object(svc, "_league_categories", AsyncMock(return_value=(["PTS"], set()))), \
         patch.object(svc, "_fantasy_teams", AsyncMock(return_value=({}, {}))):
        result = await slate_values(date(2026, 10, 25))
    assert result["complete"] is False
    box.assert_awaited_once_with("100")

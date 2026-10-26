from datetime import date
from unittest.mock import AsyncMock, patch

import pytest

from app.services import box_score_value_service as svc
from app.services.box_score_value_service import slate_values, slate_zscores, stat_line


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


def test_slate_zscores_match_the_player_rankings_formula():
    # Two lines, PTS and FG%: each category's z is +1/-1 (two values), the mean
    # over categories is the line's value.
    a = stat_line(_player("1", "A", pts="30", fg="10-20"))   # 50%
    b = stat_line(_player("2", "B", pts="10", fg="2-10"))    # 20%
    zs, _ = slate_zscores([a, b], ["PTS", "FG%"], set())
    # FG% impact: (pct - mean pct 35%) * FGA -> +3.0 and -1.5 -> z +1 / -1
    assert zs == [1.0, -1.0]
    # A line with no shots has a 0 pct, which counts in the pool's mean pct.
    c = stat_line(_player("3", "C", pts="0", fg="0-0"))
    zs, _ = slate_zscores([a, b, c], ["FG%"], set())
    assert zs[0] > zs[2] > zs[1]


def test_large_slates_score_against_the_top_300():
    lines = [stat_line(_player(str(i), "X", pts=str(i))) for i in range(400)]
    zs, _ = slate_zscores(lines, ["PTS"], set())
    # Pool = the top 300 (PTS 100..399): mean 249.5. PTS 249/250 straddle zero.
    assert zs[249] < 0 < zs[250]
    assert zs[0] < -2.5


def test_slate_zscores_ranks_the_big_line_first_and_reverses_turnovers():
    big = stat_line(_player("1", "Big", pts="52", reb="8", ast="10", fg="17-30", fg3="8-18", ft="10-11"))
    mid = stat_line(_player("2", "Mid"))
    low = stat_line(_player("3", "Low", pts="0", reb="1", ast="0", fg="0-6", fg3="0-3", ft="0-0", stl="0"))
    zs, used = slate_zscores([big, mid, low], ["PTS", "REB", "AST", "FG%", "TO", "XYZ"], {"TO"})
    assert used == ["PTS", "REB", "AST", "FG%", "TO"]
    assert zs[0] > zs[1] > zs[2]
    # Equal lines sum to zero once every category is centred.
    same = [stat_line(_player(str(i), "X")) for i in range(3)]
    assert slate_zscores(same, ["PTS", "FG%"], set())[0] == [0.0, 0.0, 0.0]


def test_turnovers_count_against_the_line():
    careful = stat_line(_player("1", "A", tov="0"))
    sloppy = stat_line(_player("2", "B", tov="6"))
    zs, _ = slate_zscores([careful, sloppy], ["TO"], {"TO"})
    assert zs[0] > 0 > zs[1]


def test_zero_minute_lines_get_a_z_but_stay_out_of_the_pool():
    a = stat_line(_player("1", "A", pts="30", fg="10-20"))
    b = stat_line(_player("2", "B", pts="10", fg="2-10"))
    idle = stat_line(_player("3", "C", minutes="0", pts="0", fg="0-0", fg3="0-0", ft="0-0",
                             reb="0", ast="0", stl="0", tov="0"))
    with_idle, _ = slate_zscores([a, b, idle], ["PTS"], set())
    without, _ = slate_zscores([a, b], ["PTS"], set())
    assert with_idle[:2] == without          # the pool is unchanged by him
    assert with_idle[2] == -2.0              # 0 pts against mean 20, std 10


def test_slate_zscores_with_no_lines():
    assert slate_zscores([], ["PTS"], set()) == ([], ["PTS"])


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
    assert result["categories"] == ["PTS", "FG%"]
    # A 0-minute line that was not a DNP is in the pool too.
    names = [p["name"] for p in result["players"]]
    assert names[0] == "Luka" and sorted(names) == ["Bench Guy", "Luka", "Quiet"]
    luka = result["players"][0]
    bench = next(p for p in result["players"] if p["name"] == "Bench Guy")
    assert luka["z"] > 0 > bench["z"]
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

from datetime import date

import pytest

from app.services.box_score_service import (
    BoxScoreUnavailable,
    parse_boxscore,
    parse_scoreboard,
)


def _team(team_id, abbr, name, short, home_away, score="0", winner=False, color="002B5C"):
    return {
        "homeAway": home_away,
        "score": score,
        "winner": winner,
        "records": [{"summary": "10-5"}],
        "linescores": [
            {"displayValue": "30"},
            {"displayValue": "28"},
            {"displayValue": "22"},
            {"displayValue": "25"},
            {"displayValue": "12"},
        ],
        "team": {
            "id": team_id,
            "abbreviation": abbr,
            "displayName": name,
            "shortDisplayName": short,
            "logo": f"https://example.com/{abbr}.png",
            "color": color,
        },
    }


def _athlete(player_id, name, stats, starter=False, dnp=False, reason="", active=False, ejected=False, jersey=""):
    return {
        "starter": starter,
        "didNotPlay": dnp,
        "reason": reason,
        "active": active,
        "ejected": ejected,
        "athlete": {"id": player_id, "displayName": name, "jersey": jersey, "position": {"abbreviation": "G"}},
        "stats": stats,
    }


def _summary():
    names = ["MIN", "PTS", "FG", "3PT", "FT", "REB", "AST", "TO", "STL", "BLK", "OREB", "DREB", "PF", "+/-"]
    starter = _athlete("1", "Starter One", ["34", "22", "8-16", "2-6", "4-4", "8", "5", "2", "1", "0", "1", "7", "2", "+5"], starter=True, active=True, jersey="15")
    bench = _athlete("2", "Bench Two", ["18", "9", "3-7", "1-3", "2-2", "3", "1", "1", "0", "1", "0", "3", "1", "-2"])
    dnp = _athlete("3", "Sit Out", [], dnp=True, reason="Coach's Decision", jersey="0")
    return {
        "gameInfo": {
            "attendance": 17867,
            "venue": {"fullName": "Delta Center", "address": {"city": "Salt Lake City"}},
        },
        "header": {
            "id": "100",
            "competitions": [{
                "id": "100",
                "date": "2026-10-26T02:00Z",
                "status": {"type": {"state": "post", "completed": True, "shortDetail": "Final"}},
                "venue": {"fullName": "Delta Center"},
                "broadcasts": [{"names": ["ESPN"]}],
                "competitors": [
                    _team("26", "UTAH", "Utah Jazz", "Jazz", "home", "117", False, "002B5C"),
                    _team("13", "LAL", "Los Angeles Lakers", "Lakers", "away", "129", True, "552583"),
                ],
            }],
        },
        "boxscore": {
            "players": [
                {"team": {"id": "13"}, "statistics": [{"names": names, "athletes": [starter, bench, dnp]}]},
                {"team": {"id": "26"}, "statistics": [{"names": names, "athletes": [starter]}]},
            ],
            "teams": [
                {
                    "team": {"id": "13"},
                    "statistics": [
                        {"name": "fieldGoalsMade-fieldGoalsAttempted", "displayValue": "48-90"},
                        {"name": "fieldGoalPct", "displayValue": "53.3"},
                        {"name": "threePointFieldGoalsMade-threePointFieldGoalsAttempted", "displayValue": "12-30"},
                        {"name": "threePointFieldGoalPct", "displayValue": "40.0"},
                        {"name": "freeThrowsMade-freeThrowsAttempted", "displayValue": "21-24"},
                        {"name": "freeThrowPct", "displayValue": "87.5"},
                        {"name": "totalRebounds", "displayValue": "45"},
                        {"name": "offensiveRebounds", "displayValue": "10"},
                        {"name": "defensiveRebounds", "displayValue": "35"},
                        {"name": "assists", "displayValue": "28"},
                        {"name": "steals", "displayValue": "8"},
                        {"name": "blocks", "displayValue": "4"},
                        {"name": "totalTurnovers", "displayValue": "12"},
                        {"name": "fouls", "displayValue": "18"},
                        {"name": "pointsInPaint", "displayValue": "52"},
                        {"name": "fastBreakPoints", "displayValue": "14"},
                        {"name": "largestLead", "displayValue": "16"},
                    ],
                }
            ],
        },
    }


def test_scoreboard_orders_away_first_and_hides_scheduled_scores():
    payload = {
        "events": [
            {
                "id": "200",
                "date": "2026-10-27T00:00Z",
                "status": {"type": {"state": "pre", "shortDetail": "7:00 PM EDT"}},
                "competitions": [{
                    "broadcasts": [{"names": ["NBA TV"]}],
                    "venue": {"fullName": "Arena"},
                    "competitors": [
                        _team("13", "LAL", "Los Angeles Lakers", "Lakers", "home"),
                        _team("26", "UTAH", "Utah Jazz", "Jazz", "away"),
                    ],
                }],
            },
            {
                "id": "100",
                "date": "2026-10-26T23:00Z",
                "status": {"type": {"state": "in", "shortDetail": "Q3 4:12"}},
                "competitions": [{
                    "competitors": [
                        _team("2", "BOS", "Boston Celtics", "Celtics", "away", "80"),
                        _team("1", "ATL", "Atlanta Hawks", "Hawks", "home", "77"),
                    ],
                }],
            },
        ]
    }
    board = parse_scoreboard(payload, date(2026, 10, 26))
    assert [game["game_id"] for game in board["games"]] == ["100", "200"]
    live = board["games"][0]
    assert live["status"] == "live"
    assert live["away"]["abbreviation"] == "BOS"
    assert live["away"]["score"] == 80
    assert live["away"]["winner"] is False
    scheduled = board["games"][1]
    assert scheduled["status"] == "scheduled"
    assert scheduled["away"]["abbreviation"] == "UTAH"
    assert scheduled["home"]["abbreviation"] == "LAL"
    assert scheduled["away"]["score"] is None
    assert scheduled["broadcast"] == "NBA TV"
    assert scheduled["home"]["color"] == "002B5C"


def test_boxscore_splits_lineup_and_labels_overtime():
    box = parse_boxscore(_summary(), "100")
    assert box["status"] == "final"
    assert box["status_detail"] == "Final"
    assert box["broadcast"] == "ESPN"
    assert box["venue"] == "Delta Center, Salt Lake City"
    assert box["attendance"] == 17867
    assert box["periods"] == ["1", "2", "3", "4", "OT"]
    assert box["away"]["abbreviation"] == "LAL"
    assert box["away"]["score"] == 129
    assert box["away"]["winner"] is True
    assert box["home"]["score"] == 117
    assert [player["name"] for player in box["away"]["starters"]] == ["Starter One"]
    assert [player["name"] for player in box["away"]["bench"]] == ["Bench Two"]
    assert box["away"]["did_not_play"] == [{
        "player_id": "3",
        "name": "Sit Out",
        "jersey": "0",
        "position": "G",
        "reason": "Coach's Decision",
    }]
    assert box["away"]["starters"][0]["jersey"] == "15"
    assert box["away"]["starters"][0]["fg"] == "8-16"
    assert box["away"]["starters"][0]["plus_minus"] == "+5"
    assert box["away"]["starters"][0]["on_court"] is False
    assert box["away"]["starters"][0]["ejected"] is False
    assert box["away"]["totals"]["fg"] == "48-90"
    assert box["away"]["totals"]["pts"] == "129"
    assert box["away"]["totals"]["min"] == "52"
    assert box["away"]["shooting"]["points_in_paint"] == "52"
    assert box["home"]["totals"]["fg"] == ""
    assert box["home"]["totals"]["reb"] == "8"


def test_live_box_records_who_is_on_the_court():
    payload = _summary()
    payload["header"]["competitions"][0]["status"] = {"type": {"state": "in", "shortDetail": "Q3 4:12"}}
    athletes = payload["boxscore"]["players"][0]["statistics"][0]["athletes"]
    athletes[0]["active"] = True
    athletes[1]["active"] = False
    athletes[1]["ejected"] = True
    box = parse_boxscore(payload, "100")
    assert box["status"] == "live"
    assert [player["name"] for player in box["away"]["starters"]] == ["Starter One"]
    assert [player["name"] for player in box["away"]["bench"]] == ["Bench Two"]
    assert box["away"]["starters"][0]["on_court"] is True
    assert box["away"]["bench"][0]["on_court"] is False
    assert box["away"]["bench"][0]["ejected"] is True


def test_boxscore_keeps_the_play_by_play_in_order():
    payload = _summary()
    payload["plays"] = [
        {
            "id": "1",
            "text": "End of the 1st Quarter",
            "awayScore": 30,
            "homeScore": 28,
            "scoringPlay": False,
            "scoreValue": 0,
            "period": {"number": 1},
            "clock": {"displayValue": "0.0"},
            "type": {"text": "End Period"},
        },
        {
            "id": "2",
            "text": "Damian Lillard makes 21-foot pullup jump shot",
            "awayScore": 33,
            "homeScore": 28,
            "scoringPlay": True,
            "scoreValue": 3,
            "team": {"id": "13"},
            "period": {"number": 1},
            "clock": {"displayValue": "34.6"},
            "type": {"text": "Pullup Jump Shot"},
        },
        {"text": "   ", "period": {"number": 1}, "clock": {"displayValue": "1:00"}},
        "not-a-play",
        {
            "id": "3",
            "text": "Isaiah Collier enters the game for Darryn Peterson",
            "awayScore": 33,
            "homeScore": 28,
            "period": {"number": 2},
            "clock": {"displayValue": "8:12"},
            "team": {"id": 26},
            "type": {"text": "Substitution"},
            "participants": [{"athlete": {"id": 5001}}, {"athlete": {"id": "5002"}}, {"athlete": {}}, "junk"],
        },
    ]
    plays = parse_boxscore(payload, "100")["plays"]
    assert [play["text"] for play in plays] == [
        "End of the 1st Quarter",
        "Damian Lillard makes 21-foot pullup jump shot",
        "Isaiah Collier enters the game for Darryn Peterson",
    ]
    assert plays[0]["clock"] == "0:00"
    assert plays[0]["kind"] == "period"
    assert plays[0]["team_id"] == ""
    assert plays[1]["clock"] == "0:34.6"
    assert plays[1]["scoring"] is True
    assert plays[1]["points"] == 3
    assert plays[1]["team_id"] == "13"
    assert plays[1]["kind"] == "score"
    assert plays[1]["away_score"] == 33
    assert plays[2]["kind"] == "sub"
    assert plays[2]["clock"] == "8:12"
    assert plays[2]["team_id"] == "26"
    assert plays[2]["athlete_ids"] == ["5001", "5002"]
    assert plays[1]["athlete_ids"] == []


def test_boxscore_rejects_a_summary_without_teams():
    with pytest.raises(BoxScoreUnavailable):
        parse_boxscore({"header": {"competitions": [{"competitors": []}]}}, "9")


@pytest.mark.asyncio
async def test_a_bad_espn_box_is_not_fetched_again_right_away(monkeypatch):
    from app.services import box_score_service as svc

    svc.clear_box_score_cache()
    calls = {"n": 0}

    async def boom(url, params):
        calls["n"] += 1
        return {"not": "a box"}

    monkeypatch.setattr(svc, "_get_json", boom)
    with pytest.raises(BoxScoreUnavailable):
        await svc.boxscore_for("401")
    with pytest.raises(BoxScoreUnavailable):
        await svc.boxscore_for("401")
    assert calls["n"] == 1
    svc.clear_box_score_cache()


@pytest.mark.asyncio
async def test_concurrent_box_fetches_share_one_espn_call(monkeypatch):
    import asyncio

    from app.services import box_score_service as svc

    svc.clear_box_score_cache()
    calls = {"n": 0}

    async def slow(url, params):
        calls["n"] += 1
        await asyncio.sleep(0.05)
        return _summary()

    monkeypatch.setattr(svc, "_get_json", slow)
    first, second = await asyncio.gather(svc.boxscore_for("100"), svc.boxscore_for("100"))
    assert calls["n"] == 1
    assert first["game_id"] == second["game_id"] == "100"
    svc.clear_box_score_cache()

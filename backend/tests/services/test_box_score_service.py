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


def _athlete(player_id, name, stats, starter=False, dnp=False, reason=""):
    return {
        "starter": starter,
        "didNotPlay": dnp,
        "reason": reason,
        "ejected": False,
        "athlete": {"id": player_id, "displayName": name, "position": {"abbreviation": "G"}},
        "stats": stats,
    }


def _summary():
    names = ["MIN", "PTS", "FG", "3PT", "FT", "REB", "AST", "TO", "STL", "BLK", "OREB", "DREB", "PF", "+/-"]
    starter = _athlete("1", "Starter One", ["34", "22", "8-16", "2-6", "4-4", "8", "5", "2", "1", "0", "1", "7", "2", "+5"], starter=True)
    bench = _athlete("2", "Bench Two", ["18", "9", "3-7", "1-3", "2-2", "3", "1", "1", "0", "1", "0", "3", "1", "-2"])
    dnp = _athlete("3", "Sit Out", [], dnp=True, reason="Coach's Decision")
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
        "position": "G",
        "reason": "Coach's Decision",
    }]
    assert box["away"]["starters"][0]["fg"] == "8-16"
    assert box["away"]["starters"][0]["plus_minus"] == "+5"
    assert box["away"]["totals"]["fg"] == "48-90"
    assert box["away"]["totals"]["pts"] == "129"
    assert box["away"]["totals"]["min"] == "52"
    assert box["away"]["shooting"]["points_in_paint"] == "52"
    assert box["home"]["totals"]["fg"] == ""
    assert box["home"]["totals"]["reb"] == "8"


def test_boxscore_rejects_a_summary_without_teams():
    with pytest.raises(BoxScoreUnavailable):
        parse_boxscore({"header": {"competitions": [{"competitors": []}]}}, "9")

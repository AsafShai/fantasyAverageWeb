from app.services.player_season_history_service import parse_season_history

NAMES = [
    "gamesPlayed", "gamesStarted", "avgMinutes", "avgFieldGoalsMade-avgFieldGoalsAttempted", "fieldGoalPct",
    "avgThreePointFieldGoalsMade-avgThreePointFieldGoalsAttempted", "threePointFieldGoalPct",
    "avgFreeThrowsMade-avgFreeThrowsAttempted", "freeThrowPct", "avgOffensiveRebounds", "avgDefensiveRebounds",
    "avgRebounds", "avgAssists", "avgBlocks", "avgSteals", "avgFouls", "avgTurnovers", "avgPoints",
]


def _row(year, label, slug, team_id, gp, pts):
    return {
        "season": {"year": year, "displayName": label},
        "teamSlug": slug,
        "teamId": team_id,
        "stats": [str(gp), str(gp), "35.0", "9.0-18.0", "50.0", "2.0-5.0", "40.0", "4.0-5.0", "80.0",
                  "1.0", "6.0", "7.0", "8.0", "0.5", "1.2", "1.5", "3.4", str(pts)],
    }


DATA = {
    "teams": {"dallas-mavericks": {"abbreviation": "DAL"}, "los-angeles-lakers": {"abbreviation": "LAL"}},
    "categories": [{
        "name": "averages",
        "names": NAMES,
        "statistics": [
            _row(2023, "2022-23", "dallas-mavericks", "6", 66, 32.4),
            _row(2024, "2023-24", "dallas-mavericks", "6", 70, 33.9),
            _row(2025, "2024-25", "dallas-mavericks", "6", 22, 28.1),
            _row(2025, "2024-25", "los-angeles-lakers", "13", 28, 28.2),
            _row(2025, "2024-25", "2024-25 Totals", None, 50, 28.2),
            _row(2026, "2025-26", "los-angeles-lakers", "13", 64, 33.5),
            _row(2027, "2026-27", "los-angeles-lakers", "13", 11, 30.0),
        ],
    }],
}


def test_skips_current_season_and_orders_newest_first():
    lines = parse_season_history(DATA, current_season=2027, limit=4)
    assert [l.season for l in lines] == [2026, 2025, 2024, 2023]


def test_traded_season_uses_totals_row_and_lists_both_teams():
    lines = parse_season_history(DATA, current_season=2027, limit=4)
    traded = next(l for l in lines if l.season == 2025)
    assert traded.gp == 50
    assert traded.teams == ["DAL", "LAL"]


def test_parses_pairs_and_percentages():
    line = parse_season_history(DATA, current_season=2027, limit=1)[0]
    assert line.fgm == 9.0 and line.fga == 18.0
    assert line.fg_percentage == 0.5
    assert line.ft_percentage == 0.8
    assert line.three_pm == 2.0
    assert line.to == 3.4
    assert line.pts == 33.5


def test_limit_and_empty_payload():
    assert len(parse_season_history(DATA, current_season=2027, limit=2)) == 2
    assert parse_season_history({}, current_season=2027, limit=4) == []

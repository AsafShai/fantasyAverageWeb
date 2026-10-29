from datetime import date

from app.services.nba_player_service import game_from_row


def _row(**overrides):
    base = {
        "game_id": "401909892",
        "season": "2026-27",
        "game_date": date(2026, 10, 28),
        "matchup": "LAC vs. LAL",
        "min": 32.0,
        "pts": 28.0,
        "reb": 6.0,
        "ast": 5.0,
        "stl": 1.0,
        "blk": 0.0,
        "tov": 3.0,
        "fg3m": 4.0,
        "fg3a": 9.0,
        "fgm": 10.0,
        "fga": 18.0,
        "ftm": 4.0,
        "fta": 4.0,
        "plus_minus": 12.0,
        "team_pts": 112.0,
        "opp_pts": 104.2,
    }
    base.update(overrides)
    return base


def test_home_matchup_parses_opponent_and_rounds_scores():
    game = game_from_row(_row())
    assert game.opponent == "LAL"
    assert game.is_home is True
    assert game.team_pts == 112
    assert game.opp_pts == 104
    assert game.minutes == 32.0


def test_away_matchup():
    game = game_from_row(_row(matchup="LAL @ LAC"))
    assert game.opponent == "LAC"
    assert game.is_home is False


def test_missing_scores_stay_empty():
    game = game_from_row(_row(team_pts=None, opp_pts=None, matchup=""))
    assert game.team_pts is None
    assert game.opp_pts is None
    assert game.opponent == ""
    assert game.is_home is True

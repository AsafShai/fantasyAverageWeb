from datetime import date

import pytest

from app.services.nba_player_service import apply_fantasy, game_from_row, night_line, nights_from_rows
from app.services.with_without_service import usage_pct


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


def test_apply_fantasy_keeps_a_night_blank_when_its_roster_was_not_read():
    home = game_from_row(_row())
    away = game_from_row(_row(game_id="2", game_date=date(2026, 11, 2), matchup="LAL @ BOS"))
    attached = apply_fantasy([home, away], {
        home.game_date: {
            "fantasy_team": "TTP",
            "fantasy_team_name": "Trust the process",
            "lineup_slot": "BE",
            "started": False,
        },
        away.game_date: None,
    })
    assert attached[0].fantasy is not None
    assert attached[0].fantasy.fantasy_team == "TTP"
    assert attached[0].fantasy.fantasy_team_name == "Trust the process"
    assert attached[0].fantasy.lineup_slot == "BE"
    assert attached[0].fantasy.started is False
    assert attached[1].fantasy is None


def test_usage_is_that_games_rate_and_blank_when_he_sat():
    played = game_from_row(_row(min=30, fga=14, fta=2, tov=2, t_fga=88, t_fta=20, t_tov=13, t_min=240))
    assert played.usg == round(usage_pct(14, 2, 2, 30, 88, 20, 13, 240), 1)
    sat = game_from_row(_row(min=0, t_fga=88, t_fta=20, t_tov=13, t_min=240))
    assert sat.usg is None
    assert game_from_row(_row()).usg is None


def test_missing_scores_stay_empty():
    game = game_from_row(_row(team_pts=None, opp_pts=None, matchup=""))
    assert game.team_pts is None
    assert game.opp_pts is None
    assert game.opponent == ""
    assert game.is_home is True

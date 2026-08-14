"""Contract tests against the LIVE ESPN site API.

Everything else in the suite feeds `espn.fetch_day` fake JSON, so a schema change
on ESPN's side (renamed stat labels, a moved athlete id, reworded Cup/All-Star
notes) passes CI and silently poisons the feature store. These tests hit the real
endpoint and assert the invariants the whole model pipeline depends on.

Excluded from the default run — they need network and take ~30s:

    uv run pytest -m live tests/live -q

The three dates below are fixed points in a finished season, so the expected
answers never drift. Each test fails loudly (not vacuously) if its date turns out
to have no games at all, which is the signal that the date needs updating.
"""

from __future__ import annotations

from datetime import date

import pytest

from app.services.model_nightly_service import _FS_PLAYER_COLS, _FS_TEAM_COLS
from model_stats_inference.espn import client, games

pytestmark = pytest.mark.live

REGULAR_NIGHT = date(2026, 1, 14)
CUP_FINAL_NIGHT = date(2025, 12, 16)
ALL_STAR_NIGHT = date(2026, 2, 15)
OFFSEASON_NIGHT = date(2026, 7, 15)

_COUNTING = ["PTS", "REB", "OREB", "DREB", "AST", "FG3M", "FG3A",
             "STL", "BLK", "TOV", "FGM", "FGA", "FTM", "FTA", "PF"]


@pytest.fixture(scope="module")
def night():
    return games.fetch_day(REGULAR_NIGHT)


def test_slate_is_final_and_non_empty(night):
    assert night.expected_games >= 2
    assert night.all_final


def test_row_counts_match_slate(night):
    assert len(night.teams) == 2 * night.expected_games
    per_game = len(night.players) / night.expected_games
    assert 14 <= per_game <= 32


def test_frame_schema_matches_db_column_order(night):
    assert list(night.players.columns) == games.PLAYER_COLUMNS
    assert list(night.teams.columns) == games.TEAM_COLUMNS
    assert games.PLAYER_COLUMNS == _FS_PLAYER_COLS
    assert games.TEAM_COLUMNS == _FS_TEAM_COLS


def test_no_nulls_in_key_columns(night):
    for col in ["PLAYER_ID", "GAME_ID", "TEAM_ID", "PLAYER_NAME", "MATCHUP", "MIN"]:
        assert night.players[col].notna().all(), col
    assert (night.players["PLAYER_NAME"].str.len() > 0).all()
    assert night.players["TEAM_ID"].isin(games.TEAM_IDS).all()
    assert night.teams["TEAM_ID"].isin(games.TEAM_IDS).all()


def test_stat_labels_parsed_not_zeroed(night):
    """A renamed ESPN stat label wouldn't raise — `_num` would quietly yield 0.0
    for every player. Non-zero league totals are the only proof it still parses."""
    for col in _COUNTING + ["MIN"]:
        assert night.players[col].sum() > 0, f"{col} is all zeros — label renamed?"


def test_made_never_exceeds_attempted(night):
    p = night.players
    assert (p["FGM"] <= p["FGA"]).all()
    assert (p["FG3M"] <= p["FG3A"]).all()
    assert (p["FTM"] <= p["FTA"]).all()
    assert (p["FG3M"] <= p["FGM"]).all()


def test_player_points_sum_to_the_final_score(night):
    """Catches silently dropped player rows: `build_game_rows` skips athletes
    whose stat list length mismatches, so a schema drift shows up here as a team
    whose player points no longer add up to its box score."""
    summed = night.players.groupby(["GAME_ID", "TEAM_ID"])["PTS"].sum()
    actual = night.teams.set_index(["GAME_ID", "TEAM_ID"])["PTS"]
    assert (summed == actual.reindex(summed.index)).all()


def test_positions_present_on_rotation_players(night):
    rotation = night.players[night.players["MIN"] >= 20]
    assert len(rotation) >= 5 * night.expected_games
    filled = (rotation["POSITION"].str.len() > 0).mean()
    assert filled >= 0.95


def test_minutes_are_plausible(night):
    assert night.players["MIN"].max() <= 60
    starters = night.players[night.players["MIN"] >= 25]
    assert len(starters) >= 4 * night.expected_games


def test_season_and_date_stamped_correctly(night):
    assert set(night.players["SEASON"]) == {games.season_for(REGULAR_NIGHT)}
    assert set(night.players["GAME_DATE"].dt.date) == {REGULAR_NIGHT}
    assert not night.players.duplicated(["PLAYER_ID", "GAME_ID"]).any()


def test_matchup_format(night):
    assert night.players["MATCHUP"].str.contains(r"^[A-Z]{2,3} (?:vs\.|@) [A-Z]{2,3}$", regex=True).all()


def test_cup_final_is_excluded():
    sb = client.scoreboard(CUP_FINAL_NIGHT.strftime("%Y%m%d"))
    events = sb.get("events", [])
    assert events, "no events on the Cup final date — update CUP_FINAL_NIGHT"
    assert [e for e in events if games.is_countable(e)] == []


def test_all_star_is_excluded():
    sb = client.scoreboard(ALL_STAR_NIGHT.strftime("%Y%m%d"))
    events = sb.get("events", [])
    assert events, "no events on the All-Star date — update ALL_STAR_NIGHT"
    assert [e for e in events if games.is_countable(e)] == []


def test_offseason_night_is_empty():
    day = games.fetch_day(OFFSEASON_NIGHT)
    assert day.expected_games == 0
    assert day.all_final
    assert day.players.empty

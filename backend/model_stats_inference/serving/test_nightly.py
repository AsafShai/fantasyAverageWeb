"""Tests for the nightly fetch/evaluate helpers (synthetic store, no network)."""

from __future__ import annotations

from datetime import date

import pandas as pd

from model_stats_inference.serving import nightly
from model_stats_inference.serving.inference import LiveInference, PredictionRequest

from .conftest import FULL_PID, LOW_PID, TEAM_A, TEAM_B

NIGHT_DATE = date(2024, 12, 31)  # after the synthetic schedule's last game
NIGHT_GID = "0021409900"
UNKNOWN_GID = "0021409901"
UNKNOWN_TEAM_A, UNKNOWN_TEAM_B = 30, 999
UNKNOWN_PID = 999


def test_season_for_boundaries():
    assert nightly.season_for(date(2025, 11, 1)) == "2025-26"
    assert nightly.season_for(date(2026, 3, 1)) == "2025-26"
    assert nightly.season_for(date(2026, 8, 15)) == "2026-27"


def _min_filter_player_rows(game_date: date):
    return pd.DataFrame({
        "PLAYER_ID": [1, 2, 3, 4],
        "GAME_ID": ["0022300001"] * 4,
        "GAME_DATE": [pd.Timestamp(game_date)] * 4,
        "MIN": [0.0, None, 0.5, 5.0],
        "TEAM_ID": [10, 20, 10, 20],
        "MATCHUP": ["AAA vs. BBB"] * 4,
    })


def test_fetch_night_keeps_any_played_minute(monkeypatch):
    """MIN > 0 is the write-time filter now (previously MIN >= MIN_MINUTES=2.0):
    a 0.5-minute row must survive, 0/NaN must not."""
    game_date = date(2025, 1, 15)
    monkeypatch.setattr(nightly, "_expected_regular_season_games", lambda d: (1, True))

    def fake_fetch_one_day(endpoint_cls, d):
        if endpoint_cls is nightly.playergamelogs.PlayerGameLogs:
            return _min_filter_player_rows(game_date)
        return pd.DataFrame({
            "TEAM_ID": [10, 20],
            "GAME_ID": ["0022300001", "0022300001"],
            "GAME_DATE": [pd.Timestamp(game_date)] * 2,
        })

    monkeypatch.setattr(nightly, "_fetch_one_day", fake_fetch_one_day)

    night = nightly.fetch_night(game_date)

    assert set(night.player_games["PLAYER_ID"]) == {3, 4}


def test_bootstrap_frames_keeps_any_played_minute(monkeypatch):
    game_date = pd.Timestamp(date.today())
    players_raw = pd.DataFrame({
        "PLAYER_ID": [1, 2, 3, 4],
        "GAME_ID": ["0022300001"] * 4,
        "GAME_DATE": [game_date] * 4,
        "MIN": [0.0, None, 0.5, 5.0],
    })
    team_raw = pd.DataFrame({
        "GAME_ID": ["0022300001", "0022300001"],
        "GAME_DATE": [game_date] * 2,
        "TEAM_ID": [10, 20],
    })
    monkeypatch.setattr(nightly.rdata, "fetch_player_logs", lambda seasons: players_raw)
    monkeypatch.setattr(nightly.rdata, "fetch_team_logs", lambda seasons: team_raw)
    positions = pd.DataFrame({"PLAYER_ID": [1, 2, 3, 4], "POSITION": ["G"] * 4})

    players, _ = nightly.bootstrap_frames(positions=positions)

    assert set(players["PLAYER_ID"]) == {3, 4}


def _night_player_row(pid, team, game_id, matchup, minutes=30.0):
    row = {
        "SEASON": "2024-25", "PLAYER_ID": pid, "PLAYER_NAME": f"Player {pid}",
        "TEAM_ID": team, "GAME_ID": game_id, "GAME_DATE": pd.Timestamp(NIGHT_DATE),
        "MATCHUP": matchup, "MIN": minutes,
        "PTS": 20.0, "REB": 8.0, "AST": 5.0, "FG3M": 2.0, "STL": 1.0, "BLK": 1.0,
        "FGM": 8.0, "FGA": 15.0, "FTM": 2.0, "FTA": 3.0,
        "OREB": 2.0, "DREB": 6.0, "TOV": 2.0, "PF": 2.0, "FG3A": 5.0, "PLUS_MINUS": 4.0,
    }
    return row


def _night_team_row(team, game_id):
    return {
        "SEASON": "2024-25", "TEAM_ID": team, "GAME_ID": game_id,
        "GAME_DATE": pd.Timestamp(NIGHT_DATE), "TEAM_NAME": f"Team {team}",
        "MATCHUP": "AAA vs. BBB",
        "PTS": 110.0, "REB": 44.0, "AST": 25.0, "STL": 7.0, "BLK": 5.0,
        "FG3M": 12.0, "FG_PCT": 0.47, "FGA": 88.0, "FTA": 20.0, "TOV": 14.0,
    }


def _make_night() -> nightly.NightFetch:
    player_games = pd.DataFrame([
        _night_player_row(FULL_PID, TEAM_A, NIGHT_GID, "AAA vs. BBB"),      # eligible
        _night_player_row(LOW_PID, TEAM_B, NIGHT_GID, "BBB @ AAA"),         # <10 games history
        _night_player_row(UNKNOWN_PID, TEAM_B, NIGHT_GID, "BBB @ AAA"),     # unknown player
        _night_player_row(2, UNKNOWN_TEAM_A, UNKNOWN_GID, "CCC vs. DDD"),   # opponent not in store
    ])
    team_games = pd.DataFrame([
        _night_team_row(TEAM_A, NIGHT_GID),
        _night_team_row(TEAM_B, NIGHT_GID),
        _night_team_row(UNKNOWN_TEAM_A, UNKNOWN_GID),
        _night_team_row(UNKNOWN_TEAM_B, UNKNOWN_GID),
    ])
    return nightly.NightFetch(
        game_date=NIGHT_DATE, player_games=player_games, team_games=team_games,
        expected_games=2, complete=True,
    )


def test_evaluate_night(store, models_dir):
    inference = LiveInference(store, models_dir)
    evals = {ev.player_id: ev for ev in nightly.evaluate_night(store, inference, _make_night())}
    assert len(evals) == 4

    full = evals[FULL_PID]
    assert full.eligible
    assert full.game_id == NIGHT_GID
    assert full.is_home
    assert full.real_minutes == 30.0
    assert full.predicted["PTS"] >= 0
    assert full.actual["PTS"] == 20.0
    assert full.opponent_team_id == TEAM_B

    low = evals[LOW_PID]
    assert not low.eligible and not low.predicted
    assert low.actual["PTS"] == 20.0

    unknown_player = evals[UNKNOWN_PID]
    assert not unknown_player.eligible and not unknown_player.predicted

    # Pre-filtered before predict_many (UnknownTeamError would abort the batch).
    unknown_team = evals[2]
    assert not unknown_team.eligible
    assert "not in feature store" in unknown_team.reason
    assert unknown_team.opponent_team_id == UNKNOWN_TEAM_B


def test_evaluate_night_is_leakage_safe(store, models_dir):
    """Predictions must come from the pre-night store: evaluating the same night
    twice against the same store yields identical numbers (store not mutated)."""
    inference = LiveInference(store, models_dir)
    first = nightly.evaluate_night(store, inference, _make_night())
    second = nightly.evaluate_night(store, inference, _make_night())
    assert [ev.predicted for ev in first] == [ev.predicted for ev in second]


def test_drop_stale_players_boundary():
    as_of = date(2026, 7, 3)
    df = pd.DataFrame({
        "PLAYER_ID": [1, 1, 2, 2, 3],
        "GAME_DATE": pd.to_datetime([
            "2024-01-05", "2026-01-10",  # active: newest game recent -> ALL rows kept
            "2023-11-01", "2024-04-01",  # stale: newest game > 2 years old -> dropped
            "2024-07-03",                # exactly 2 years old -> dropped (>= boundary)
        ]),
    })
    out = nightly.drop_stale_players(df, as_of)
    assert set(out["PLAYER_ID"]) == {1}
    assert len(out) == 2  # active player keeps his old rows too


def test_from_vectors_matches_original(store, models_dir):
    """A store rebuilt from just its vectors must produce identical predictions —
    this is the DB-vectors serving path (no raw rows, no recompute)."""
    from model_stats_inference.serving.feature_store import FeatureStore

    original = LiveInference(store, models_dir)
    lite_store = FeatureStore.from_vectors(
        store.player_vectors, store.team_allowed_vectors, store.team_own_vectors
    )
    lite = LiveInference(lite_store, models_dir)

    req = [PredictionRequest(player_id=FULL_PID, opponent_team_id=TEAM_B,
                             is_home=True, game_date=NIGHT_DATE, minutes=32.0)]
    (a,), _ = original.predict_many(req)
    (b,), _ = lite.predict_many(req)
    assert {k: v.value for k, v in a.stats.items()} == {k: v.value for k, v in b.stats.items()}


def test_attach_positions(store):
    rows = pd.DataFrame([
        _night_player_row(FULL_PID, TEAM_A, NIGHT_GID, "AAA vs. BBB"),
        _night_player_row(UNKNOWN_PID, TEAM_B, NIGHT_GID, "BBB @ AAA"),
    ])
    out = nightly.attach_positions(store, rows)
    assert out.loc[out["PLAYER_ID"] == FULL_PID, "POSITION"].iloc[0] == "G"
    assert out.loc[out["PLAYER_ID"] == UNKNOWN_PID, "POSITION"].iloc[0] == ""

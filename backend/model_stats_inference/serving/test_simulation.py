"""SeasonSimulator tests on the synthetic dataset.

The synthetic data is one season; we relabel the first games as a prior season so
the replay has real history behind it. Run:
    uv run pytest model_stats_inference/serving/test_simulation.py
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from model_stats_inference.serving.simulation import SeasonSimulator
from model_stats_inference.serving.conftest import FULL_PID


def _make_sim(raw_players, team_tables, models_dir, history_days=10):
    players = raw_players.copy()
    dates = sorted(players["GAME_DATE"].unique())
    cut = dates[history_days]
    players["SEASON"] = np.where(players["GAME_DATE"] < cut, "2023-24", "2025-26")
    team_allowed, team_own = team_tables
    sim = SeasonSimulator(players, team_allowed, team_own, models_dir=models_dir, season="2025-26")
    return sim, dates, history_days


def test_state_and_schedule(raw_players, team_tables, models_dir):
    sim, dates, hist = _make_sim(raw_players, team_tables, models_dir)
    st = sim.state()
    assert st["total_days"] == len(dates) - hist
    assert st["next_game_day"] is not None
    assert st["num_games"] >= 1


def test_eligible_with_history_and_minutes_monotonic(raw_players, team_tables, models_dir):
    sim, _, _ = _make_sim(raw_players, team_tables, models_dir)
    preds = sim.predict_upcoming()
    eligible = [p for p in preds if p.eligible]
    assert eligible, "expected at least one player with >=10 games of history"

    # FULL_PID has a long history -> eligible and minutes-monotonic on points.
    low = sim.predict_player(FULL_PID, 20).stats["PTS"].value
    high = sim.predict_player(FULL_PID, 38).stats["PTS"].value
    assert high > low


def test_advance_reveals_eval_and_grows_store(raw_players, team_tables, models_dir):
    sim, _, _ = _make_sim(raw_players, team_tables, models_dir)
    before = sim.store.get_player_state(FULL_PID).games_count
    evals = sim.advance()
    assert evals and any(e.eligible for e in evals)
    one = next(e for e in evals if e.eligible)
    assert set(["PTS", "FG_PCT"]).issubset(one.predicted) and "PTS" in one.actual
    after = sim.store.get_player_state(FULL_PID).games_count
    assert after == before + 1  # the played day was folded into the store


def test_runs_to_completion(raw_players, team_tables, models_dir):
    sim, dates, hist = _make_sim(raw_players, team_tables, models_dir)
    steps = 0
    while not sim.finished:
        sim.advance()
        steps += 1
    assert steps == len(dates) - hist
    assert sim.predict_upcoming() == []

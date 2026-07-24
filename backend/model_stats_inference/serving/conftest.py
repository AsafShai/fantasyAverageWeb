"""Hermetic synthetic fixtures for the serving tests — no external APIs, no network.

Builds a small but realistic dataset: two teams playing a 30-game schedule, three
full-history players and one low-history player (5 games). Stats scale with minutes
so the minutes features are genuinely predictive (lets us assert monotonicity).
"""

from __future__ import annotations

from types import SimpleNamespace

import joblib
import numpy as np
import pandas as pd
import pytest
from sklearn.metrics import mean_squared_error

from model_stats_inference.research import config as rconfig
from model_stats_inference.research import data as rdata
from model_stats_inference.research import features as rfeatures
from model_stats_inference.serving.feature_store import FeatureStore
from model_stats_inference.training import models as registry
from model_stats_inference.training.reconcile import build_reconciler

TEAM_A, TEAM_B = 10, 20
FULL_PID, LOW_PID = 1, 4
N_GAMES = 30
SEASON = "2024-25"

# Per-minute production rates for the base stats (rough NBA scale).
_RATES = {
    "PTS": 0.60, "REB": 0.25, "OREB": 0.07, "DREB": 0.18, "AST": 0.15,
    "FG3M": 0.06, "FG3A": 0.18, "STL": 0.04, "BLK": 0.03, "TOV": 0.07,
    "FGM": 0.22, "FGA": 0.45, "FTM": 0.12, "FTA": 0.15, "PF": 0.07,
}
_PLAYERS = [
    # pid, team, opp, position, game range, scale factor
    (1, TEAM_A, TEAM_B, "G", range(0, 25), 1.2),
    (2, TEAM_A, TEAM_B, "F", range(5, 30), 0.9),
    (3, TEAM_B, TEAM_A, "C", range(0, 25), 1.0),
    (4, TEAM_B, TEAM_A, "G-F", range(0, 5), 1.1),  # low history
]


def _schedule():
    base = pd.Timestamp("2024-11-01")
    dates = [base + pd.Timedelta(days=2 * i) for i in range(N_GAMES)]
    gids = [f"002140{i:04d}" for i in range(N_GAMES)]
    return dates, gids


def _make_players(rng) -> pd.DataFrame:
    dates, gids = _schedule()
    rows = []
    for pid, team, opp, pos, games, factor in _PLAYERS:
        for gi in games:
            mins = float(rng.uniform(22, 36))
            row = {
                "SEASON": SEASON, "PLAYER_ID": pid, "PLAYER_NAME": f"Player {pid}",
                "TEAM_ID": team, "GAME_ID": gids[gi], "GAME_DATE": dates[gi],
                "MATCHUP": f"AAA {'vs.' if gi % 2 == 0 else '@'} BBB",
                "POSITION": pos, "MIN": round(mins, 1),
                "PLUS_MINUS": float(round(rng.normal(0, 8))),
            }
            for stat, rate in _RATES.items():
                noise = rng.normal(0, max(1.0, rate * mins * 0.2))
                row[stat] = max(0, round(rate * factor * mins + noise))
            row["FGA"] = max(row["FGA"], row["FGM"])
            row["FTA"] = max(row["FTA"], row["FTM"])
            row["FG3A"] = max(row["FG3A"], row["FG3M"])
            rows.append(row)
    return pd.DataFrame(rows)


def _make_team_logs(rng) -> pd.DataFrame:
    dates, gids = _schedule()
    rows = []
    for gi in range(N_GAMES):
        for team in (TEAM_A, TEAM_B):
            rows.append({
                "SEASON": SEASON, "TEAM_ID": team, "GAME_ID": gids[gi], "GAME_DATE": dates[gi],
                "PTS": round(rng.normal(112, 9)), "REB": round(rng.normal(44, 5)),
                "AST": round(rng.normal(25, 4)), "STL": round(rng.normal(7, 2)),
                "BLK": round(rng.normal(5, 2)), "FG3M": round(rng.normal(12, 3)),
                "FG_PCT": round(float(rng.normal(0.47, 0.04)), 3),
                "FGA": round(rng.normal(88, 6)), "FTA": round(rng.normal(20, 5)),
                "TOV": round(rng.normal(14, 3)),
            })
    return pd.DataFrame(rows)


@pytest.fixture(scope="module")
def raw_players() -> pd.DataFrame:
    return _make_players(np.random.default_rng(0))


@pytest.fixture(scope="module")
def team_logs() -> pd.DataFrame:
    return _make_team_logs(np.random.default_rng(1))


@pytest.fixture(scope="module")
def team_tables(team_logs):
    return rdata.build_team_allowed(team_logs), rdata.build_team_own(team_logs)


@pytest.fixture
def store(raw_players, team_tables) -> FeatureStore:
    # Function-scoped: test_feature_store.py's test_nightly_update_appends_and_recomputes
    # mutates the store in place via update_with_nightly_results, so it can't be
    # shared across tests. Cheap to rebuild (no training) -- unlike feature_matrix
    # / models_dir below, which stay module-scoped for the real time savings.
    team_allowed, team_own = team_tables
    return FeatureStore.build(raw_players, team_allowed, team_own)


@pytest.fixture(scope="module")
def feature_matrix(raw_players, team_tables) -> pd.DataFrame:
    team_allowed, team_own = team_tables
    return rfeatures.build_feature_matrix(raw_players, team_allowed, team_own)


# Deterministic fixed-seed synthetic data + read-only consumers (verified across
# test_inference.py/test_reconcile.py/test_nightly.py) -- module scope trains
# these tiny models once per file instead of once per test.
@pytest.fixture(scope="module")
def models_dir(feature_matrix, tmp_path_factory):
    """Train tiny per-target models on the synthetic data so inference can run,
    plus a reconciler built from in-sample residuals (pseudo-OOF)."""
    out = tmp_path_factory.mktemp("models")
    pseudo = {}  # target -> namespace(oof_true, oof_pred, oof_index) for the reconciler
    for target in rconfig.TARGETS:
        feats = [
            "T_MIN", f"T_x_{target}_global_rate",
            f"{target}_global_mean", f"{target}_w5_mean",
        ]
        sub = feature_matrix[feature_matrix[f"y_{target}"].notna()]
        X, y = sub[feats], sub[f"y_{target}"].astype(float)
        model = registry.build_estimator("hgb_l2").fit(X, y)
        pred = model.predict(X)
        rmse = float(np.sqrt(mean_squared_error(y, pred)))
        joblib.dump(
            {"target": target, "features": feats, "model": model,
             "model_name": "hgb_l2", "clip_at_zero": True,
             "metrics": {"rmse_mean": rmse}},
            out / f"{target}.joblib",
        )
        pseudo[target] = SimpleNamespace(
            oof_true=y.to_numpy(), oof_pred=pred, oof_index=y.index.to_numpy())

    joblib.dump(build_reconciler(pseudo), out / "reconciler.joblib")
    return out

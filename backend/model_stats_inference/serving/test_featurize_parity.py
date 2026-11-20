"""serving/featurize.py (Polars + NumPy, used by the web process) must produce
exactly what research/features.py (pandas, used for training) produces: same
columns, same row order, bit-identical floats. pandas is a test dependency."""

import numpy as np
import pandas as pd
import polars as pl
import pytest

from model_stats_inference.research import data as rdata
from model_stats_inference.research import features as rfeatures
from model_stats_inference.serving import featurize


def _random_history(seed: int, n_players: int = 70, n_teams: int = 6, n_days: int = 160):
    """Messy but realistic: trades, DNP-ish cameos (USG imputation), NaN-free
    minutes, back-to-backs, players who only ever play cameo minutes, missing
    positions, and more players than one PLAYER_VECTOR_CHUNK."""
    rng = np.random.default_rng(seed)
    base = pd.Timestamp("2023-10-20")
    days = sorted(rng.choice(n_days, size=n_days // 2, replace=False))
    teams = list(range(1, n_teams + 1))
    team_rows, player_rows = [], []
    roster = {pid: teams[pid % n_teams] for pid in range(100, 100 + n_players)}
    gid = 0
    for d in days:
        date = base + pd.Timedelta(days=int(d))
        order = rng.permutation(teams)
        for a, b in zip(order[0::2], order[1::2]):
            gid += 1
            g = f"40{gid:06d}"
            for t, o in ((a, b), (b, a)):
                team_rows.append({
                    "SEASON": "2023-24", "TEAM_ID": int(t), "GAME_ID": g, "GAME_DATE": date,
                    "PTS": float(rng.integers(90, 135)), "REB": float(rng.integers(35, 55)),
                    "AST": float(rng.integers(18, 32)), "STL": float(rng.integers(3, 12)),
                    "BLK": float(rng.integers(1, 9)), "FG3M": float(rng.integers(6, 20)),
                    "FG_PCT": float(np.round(rng.normal(0.47, 0.04), 3)),
                    "FGA": float(rng.integers(75, 100)), "FTA": float(rng.integers(10, 32)),
                    "TOV": float(rng.integers(8, 20)),
                })
                for pid, team in roster.items():
                    if team != t or rng.random() < 0.15:
                        continue
                    cameo = pid % 17 == 0 or rng.random() < 0.08
                    mins = float(np.round(rng.uniform(1, 4.9) if cameo else rng.uniform(8, 40), 1))
                    r = {"SEASON": "2023-24", "PLAYER_ID": pid, "PLAYER_NAME": f"P{pid}",
                         "TEAM_ID": int(t), "GAME_ID": g, "GAME_DATE": date,
                         "MATCHUP": f"X {'vs.' if t == a else '@'} Y",
                         "POSITION": "" if pid % 11 == 0 else ["G", "F", "C", "G-F"][pid % 4],
                         "MIN": mins, "PLUS_MINUS": float(rng.integers(-20, 21))}
                    for s, rate in (("PTS", .5), ("REB", .2), ("OREB", .05), ("DREB", .15),
                                    ("AST", .12), ("FG3M", .05), ("FG3A", .14), ("STL", .03),
                                    ("BLK", .02), ("TOV", .06), ("FGM", .2), ("FGA", .42),
                                    ("FTM", .1), ("FTA", .13), ("PF", .07)):
                        r[s] = float(max(0, round(rate * mins + rng.normal(0, 1.5))))
                    r["FGA"] = max(r["FGA"], r["FGM"])
                    r["FTA"] = max(r["FTA"], r["FTM"])
                    r["FG3A"] = max(r["FG3A"], r["FG3M"])
                    player_rows.append(r)
        if rng.random() < 0.05:  # a trade
            pid = int(rng.choice(list(roster)))
            roster[pid] = int(rng.choice(teams))
    players = pd.DataFrame(player_rows)
    teams_df = pd.DataFrame(team_rows)
    # shuffle row order: the code must not depend on input order beyond what pandas does
    players = players.sample(frac=1.0, random_state=seed).reset_index(drop=True)
    return players, teams_df


def _to_pl(df: pd.DataFrame) -> pl.DataFrame:
    out = pl.from_dict({c: df[c].tolist() for c in df.columns})
    if "GAME_DATE" in out.columns:
        out = out.with_columns(pl.col("GAME_DATE").cast(pl.Date))
    return out


def _assert_frame_bitwise(want: pd.DataFrame, got: pl.DataFrame):
    assert list(want.columns) == got.columns
    assert len(want) == got.height
    for c in want.columns:
        w = want[c]
        g = got[c]
        if pd.api.types.is_float_dtype(w.dtype):
            np.testing.assert_array_equal(
                w.to_numpy(dtype=np.float64).view(np.int64), g.to_numpy().astype(np.float64).view(np.int64),
                err_msg=c)
        elif pd.api.types.is_datetime64_any_dtype(w.dtype):
            assert [x.date() for x in w] == g.to_list(), c
        else:
            assert w.tolist() == g.to_list(), c


@pytest.mark.parametrize("seed", [0, 1, 2])
def test_build_current_state_bit_identical(seed):
    players, team_logs = _random_history(seed)
    ta, to = rdata.build_team_allowed(team_logs), rdata.build_team_own(team_logs)
    tl = _to_pl(team_logs)
    ta_pl, to_pl = featurize.build_team_allowed(tl), featurize.build_team_own(tl)
    _assert_frame_bitwise(ta, ta_pl)
    _assert_frame_bitwise(to, to_pl)

    want = rfeatures.build_current_state(players, ta, to)
    got = featurize.build_current_state(_to_pl(players), ta_pl, to_pl)
    for w, g in zip(want, got):
        _assert_frame_bitwise(w, g)


def test_subset_recompute_with_pace_source_bit_identical():
    """The nightly fold-in recomputes a few players from a filtered team_own
    with the full frame as pace_source."""
    players, team_logs = _random_history(5)
    ta, to = rdata.build_team_allowed(team_logs), rdata.build_team_own(team_logs)
    pick = sorted(players["PLAYER_ID"].unique())[::7]
    sub = players[players["PLAYER_ID"].isin(pick)]
    teams = sorted(sub["TEAM_ID"].unique())[:3]
    want = rfeatures.build_current_state(
        sub, ta[ta["TEAM_ID"].isin(teams)], to[to["TEAM_ID"].isin(teams)], pace_source=to)
    tl = _to_pl(team_logs)
    ta_pl, to_pl = featurize.build_team_allowed(tl), featurize.build_team_own(tl)
    got = featurize.build_current_state(
        _to_pl(sub), ta_pl.filter(pl.col("TEAM_ID").is_in(teams)),
        to_pl.filter(pl.col("TEAM_ID").is_in(teams)), pace_source=to_pl)
    for w, g in zip(want, got):
        _assert_frame_bitwise(w, g)


def test_fixture_store_bit_identical(raw_players, team_logs):
    ta, to = rdata.build_team_allowed(team_logs), rdata.build_team_own(team_logs)
    want = rfeatures.build_current_state(raw_players, ta, to)
    tl = _to_pl(team_logs)
    got = featurize.build_current_state(
        _to_pl(raw_players), featurize.build_team_allowed(tl), featurize.build_team_own(tl))
    for w, g in zip(want, got):
        _assert_frame_bitwise(w, g)

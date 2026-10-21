from datetime import date, datetime, timezone

import numpy as np
import pandas as pd
import pytest

from app.config import settings
from app.services import surprise_service
from app.services.surprise_service import SurpriseService, score_night
from model_stats_inference.serving import surprise

NIGHT = date(2025, 12, 1)


def _player(pid: int, name: str, team: int, pts_level: float, tonight: float | None, seed: int) -> pd.DataFrame:
    """14 ordinary games; ``tonight`` scales the whole last line (None = ordinary,
    0 = a scoreless 0/11 night, 3 = three times his usual everything)."""
    rng = np.random.default_rng(seed)
    n = 14
    pts = np.clip(rng.normal(pts_level, 3.0, n), 0, None).round()
    line = {"REB": 5.0, "AST": 4.0, "FG3M": 1.0, "STL": 1.0, "BLK": 0.5}
    scale = np.ones(n)
    if tonight is not None:
        pts[-1] = pts_level * tonight
        scale[-1] = tonight
    fga = pts.round() + 5
    if tonight == 0:
        fga[-1] = 11
    dates = list(pd.date_range("2025-11-01", periods=n - 1, freq="2D")) + [pd.Timestamp(NIGHT)]
    return pd.DataFrame({
        "PLAYER_ID": pid, "GAME_ID": [f"g{i}" for i in range(n - 1)] + ["night"],
        "SEASON": "2025-26", "GAME_DATE": dates, "PLAYER_NAME": name, "TEAM_ID": team,
        "MATCHUP": "BOS vs NYK" if team == 2 else "NYK @ BOS", "POSITION": "G",
        "MIN": 32.0, "PTS": pts, "REB": line["REB"] * scale, "OREB": 1.0, "DREB": 4.0,
        "AST": line["AST"] * scale, "FG3M": line["FG3M"] * scale, "FG3A": 3.0,
        "STL": line["STL"] * scale, "BLK": line["BLK"] * scale, "TOV": 2.0,
        "FGM": (pts / 2.2).round(), "FGA": fga, "FTM": 2.0 * scale, "FTA": 3.0 * scale,
        "PF": 2.0, "PLUS_MINUS": 0.0,
    })


@pytest.fixture
def history() -> pd.DataFrame:
    return pd.concat([
        _player(1, "Big Night", 2, 15.0, 3.0, 1),
        _player(2, "Cold Night", 18, 15.0, 0.0, 2),
        _player(3, "Plain", 2, 15.0, None, 3),
        _player(4, "Plain Two", 18, 15.0, None, 4),
    ], ignore_index=True)


def _evals(predicted_pts: dict[int, float]) -> pd.DataFrame:
    rows = []
    for pid, pts in predicted_pts.items():
        rows.append({
            "game_id": "night", "player_id": pid, "game_date": NIGHT, "player_name": "",
            "team_id": 2, "opponent_team_id": 18, "is_home": True, "minutes": 32.0,
            "eligible": True, "reason": "",
            **{f"pred_{s.lower()}": (pts if s == "PTS" else 3.0) for s in surprise.ERR_TARGETS},
            **{f"actual_{s.lower()}": 0.0 for s in surprise.ERR_TARGETS},
        })
    return pd.DataFrame(rows)


def test_score_night_scores_only_the_night_and_flags_estimates(history):
    calibration = surprise.load_calibration()
    night = score_night(history, _evals({1: 14.0}), NIGHT, calibration)

    assert len(night) == 4 and (night["GAME_DATE"].dt.date == NIGHT).all()
    by_name = night.set_index("PLAYER_NAME")
    assert by_name.at["Big Night", "SCORE"] > by_name.at["Plain", "SCORE"] > by_name.at["Cold Night", "SCORE"]
    assert by_name.at["Big Night", "SCORE"] > 1.5
    assert by_name.at["Cold Night", "SCORE"] < -1.5
    assert bool(by_name.at["Big Night", "HAS_ESTIMATE"]) is True
    assert bool(by_name.at["Cold Night", "HAS_ESTIMATE"]) is False
    lead = by_name.at["Big Night", "REASONS"][0]
    assert lead["z"] > 0 and lead["stat"] in ("PTS", "FGM", "REB", "AST", "FG3M", "STL", "BLK", "FTM")
    assert all(r["z"] > 0 for r in by_name.at["Big Night", "REASONS"])     # everything was up tonight
    assert by_name.at["Cold Night", "REASONS"][0]["z"] < 0


def test_score_night_without_eval_rows_scores_on_history_alone(history):
    night = score_night(history, pd.DataFrame(), NIGHT, surprise.load_calibration())
    assert not night["HAS_ESTIMATE"].any()
    assert night["SCORE"].notna().all()


def test_to_tuple_matches_insert_columns(history):
    night = score_night(history, _evals({1: 14.0}), NIGHT, surprise.load_calibration())
    row = night[night["PLAYER_NAME"] == "Cold Night"].iloc[0]
    t = surprise_service._to_tuple(row, NIGHT)
    assert len(t) == 24
    assert t[:3] == ("night", 2, NIGHT)
    assert t[5] == 2 and t[6] is False          # opponent from the matchup string, away
    assert t[-2] == "bad"
    assert isinstance(t[-1], list)


@pytest.mark.asyncio
async def test_night_response_sends_every_scored_row_split_by_sign(monkeypatch):
    created = datetime(2025, 12, 2, 7, 0, tzinfo=timezone.utc)

    def row(pid, score, verdict, est=True):
        return {
            "game_id": "g1" if pid % 2 else "g2", "player_id": pid, "player_name": f"P{pid}",
            "team_id": 2, "opponent_team_id": 18, "is_home": True, "minutes": 30.0,
            "pts": 10.0, "reb": 1.0, "ast": 1.0, "fg3m": 0.0, "stl": 0.0, "blk": 0.0,
            "fgm": 4.0, "fga": 9.0, "ftm": 2.0, "fta": 2.0,
            "metric_z": score, "metric_err": None, "score": score, "has_estimate": est,
            "verdict": verdict, "reasons": '[{"stat": "PTS", "value": 10.0, "avg": 5.0, "z": 1.0}]',
            "created_at": created,
        }

    rows = [row(i, 3.0 - i * 0.1, "good") for i in range(1, 20)]
    rows += [row(50, -2.0, "bad", est=False), row(51, -2.5, "bad"), row(60, 0.3, ""), row(61, -0.4, "")]
    rows.append({**row(70, None, ""), "metric_z": None})
    svc = SurpriseService()
    monkeypatch.setattr(svc._db, "get_surprises_for_date", _async_return(rows))
    monkeypatch.setattr(settings, "surprise_top_n", 5)

    out = await svc.night(NIGHT)

    assert out["game_date"] == "2025-12-01" and out["games"] == 2
    assert out["players_played"] == 24 and out["players_scored"] == 23
    assert out["players_with_estimate"] == 23
    assert out["max_rows"] == 5
    # every scored row, split by sign: the page's sliders do the filtering
    assert [r["player_id"] for r in out["good"]] == list(range(1, 20)) + [60]
    assert [r["player_id"] for r in out["bad"]] == [51, 50, 61]    # worst first
    assert out["good"][-1]["verdict"] == "" and out["bad"][0]["verdict"] == "bad"
    assert out["bad"][1]["has_estimate"] is False
    assert out["good"][0]["team_abbr"] == "BOS" and out["good"][0]["opponent_abbr"] == "NYK"
    assert out["good"][0]["reasons"][0]["stat"] == "PTS"
    assert out["thresholds"] == {"good": settings.surprise_good_threshold, "bad": settings.surprise_bad_threshold}
    assert out["computed_at"].startswith("2025-12-02T07:00")


@pytest.mark.asyncio
async def test_night_response_is_none_without_rows(monkeypatch):
    svc = SurpriseService()
    monkeypatch.setattr(svc._db, "get_surprises_for_date", _async_return([]))
    assert await svc.night(NIGHT) is None


def _async_return(value):
    async def _f(*_a, **_k):
        return value
    return _f

from datetime import date, datetime, timedelta, timezone

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
    night = score_night(history, None, _evals({1: 14.0}), NIGHT, calibration)

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
    night = score_night(history, None, pd.DataFrame(), NIGHT, surprise.load_calibration())
    assert not night["HAS_ESTIMATE"].any()
    assert night["SCORE"].notna().all()


def test_to_tuple_matches_insert_columns(history):
    night = score_night(history, history[["PLAYER_ID", "GAME_ID", "PLAYER_NAME", "TEAM_ID", "MATCHUP"]], _evals({1: 14.0}), NIGHT, surprise.load_calibration())
    row = night[night["PLAYER_NAME"] == "Cold Night"].iloc[0]
    t = surprise_service._to_tuple(row, NIGHT)
    assert len(t) == 27
    assert t[-3:] == (None, None, None)          # no roster given: free agent / unknown
    assert t[:3] == ("night", 2, NIGHT)
    assert t[5] == 2 and t[6] is False          # opponent from the matchup string, away
    assert t[-5] == "bad"
    assert isinstance(t[-4], list)
    t2 = surprise_service._to_tuple(row, NIGHT, {2: {"team_id": 7, "team": "AAT", "team_name": "Alon", "slot": "BE"}})
    assert t2[-3:] == (7, "AAT", "BE")


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
            "fantasy_team_id": 7 if pid % 2 else None, "fantasy_team": "AAT" if pid % 2 else None,
            "lineup_slot": ("BE" if pid == 51 else "PG") if pid % 2 else None,
        }

    rows = [row(i, 3.0 - i * 0.1, "good") for i in range(1, 20)]
    rows += [row(50, -2.0, "bad", est=False), row(51, -2.5, "bad"), row(60, 0.3, ""), row(61, -0.4, "")]
    rows.append({**row(70, None, ""), "metric_z": None})
    svc = SurpriseService()
    monkeypatch.setattr(svc._db, "get_surprises_for_date", _async_return(rows))
    monkeypatch.setattr(svc._db, "get_latest_model_nightly_run", _async_return({"game_date": NIGHT + timedelta(days=1), "status": "no_games"}))
    out = await svc.night(NIGHT)
    assert out["latest_run"] == {"game_date": "2025-12-02", "status": "no_games"}

    assert out["game_date"] == "2025-12-01" and out["games"] == 2
    assert out["players_played"] == 24 and out["players_scored"] == 23
    assert out["players_with_estimate"] == 23
    assert "max_rows" not in out
    # every scored row, split by sign: the page's sliders do the filtering
    assert [r["player_id"] for r in out["good"]] == list(range(1, 20)) + [60]
    assert [r["player_id"] for r in out["bad"]] == [51, 50, 61]    # worst first
    assert out["good"][-1]["verdict"] == "" and out["bad"][0]["verdict"] == "bad"
    assert out["bad"][1]["has_estimate"] is False
    assert out["good"][0]["team_abbr"] == "BOS" and out["good"][0]["opponent_abbr"] == "NYK"
    assert out["good"][0]["reasons"][0]["stat"] == "PTS"
    assert out["good"][0]["fantasy_team"] == "AAT" and out["good"][0]["started"] is True     # PG slot
    assert out["good"][1]["fantasy_team"] is None and out["good"][1]["started"] is None      # free agent
    assert out["bad"][0]["lineup_slot"] == "BE" and out["bad"][0]["started"] is False
    assert out["thresholds"] == {"good": settings.surprise_good_threshold, "bad": settings.surprise_bad_threshold}
    assert out["computed_at"].startswith("2025-12-02T07:00")


@pytest.mark.asyncio
async def test_night_response_is_none_without_rows(monkeypatch):
    svc = SurpriseService()
    monkeypatch.setattr(svc._db, "get_surprises_for_date", _async_return([]))
    assert await svc.night(NIGHT) is None


@pytest.mark.asyncio
async def test_latest_date_is_a_max_not_a_scan(monkeypatch):
    svc = SurpriseService()
    monkeypatch.setattr(svc._db, "get_latest_surprise_date", _async_return(NIGHT))
    monkeypatch.setattr(svc._db, "get_surprise_dates", _async_return(pytest.fail))
    assert await svc.latest_date() == NIGHT


def _async_return(value):
    async def _f(*_a, **_k):
        return value
    return _f


def _window_player(pid, name, team, games, score_sum, pts, **over):
    base = {
        "player_id": pid, "player_name": name, "team_id": team, "fantasy_team": None,
        "games": games, "score_sum": score_sum, "has_estimate": True,
        "minutes": 30.0 * games, "pts": pts, "reb": 5.0 * games, "ast": 4.0 * games,
        "fg3m": 1.0 * games, "stl": 1.0 * games, "blk": 0.0, "fgm": 8.0 * games,
        "fga": 15.0 * games, "ftm": 2.0 * games, "fta": 2.0 * games,
    }
    base.update(over)
    return base


@pytest.mark.asyncio
async def test_window_averages_nightly_scores_by_games_played(monkeypatch):
    """A one-game +3 outranks two games that add up to +4 (average +2). The span
    is the calendar days ending on the night, and a missing end uses the latest."""
    svc = SurpriseService()
    grouped = [
        _window_player(1, "Steady", 2, 2, 4.0, 40.0, fantasy_team="DOR", fantasy_team_id=8),
        _window_player(2, "Once", 18, 1, 3.0, 30.0, has_estimate=False),
        _window_player(3, "Cold", 2, 2, -3.0, 10.0),
    ]
    summary = {
        "games": 5, "players_played": 4, "players_scored": 3, "players_with_estimate": 2,
        "computed_at": datetime(2025, 12, 2, 7, 0, tzinfo=timezone.utc),
    }
    seen: dict = {}

    async def _fetch(start, end):
        seen["start"], seen["end"] = start, end
        return summary, grouped

    monkeypatch.setattr(svc._db, "get_surprise_window", _fetch)
    monkeypatch.setattr(svc._db, "get_latest_model_nightly_run", _async_return(None))

    out = await svc.window(7, NIGHT)
    assert seen == {"start": date(2025, 11, 25), "end": NIGHT}
    assert out["days"] == 7 and out["start_date"] == "2025-11-25" and out["game_date"] == "2025-12-01"
    assert out["games"] == 5 and out["players_scored"] == 3
    assert [r["player_name"] for r in out["good"]] == ["Once", "Steady"]
    assert out["good"][0]["score"] == 3 and out["good"][0]["games"] == 1
    assert out["good"][0]["has_estimate"] is False and out["good"][0]["started"] is None
    assert out["good"][1]["score"] == 2 and out["good"][1]["pts"] == 20 and out["good"][1]["games"] == 2
    assert out["good"][1]["fantasy_team"] == "DOR" and out["good"][1]["fantasy_team_id"] == 8
    assert out["bad"][0]["player_name"] == "Cold" and out["bad"][0]["score"] == -1.5

    monkeypatch.setattr(svc._db, "get_latest_surprise_date", _async_return(NIGHT))
    await svc.window(28, None)
    assert seen["start"] == NIGHT - timedelta(days=27) and seen["end"] == NIGHT


@pytest.mark.asyncio
async def test_backfill_scores_each_unscored_night_and_keeps_going(monkeypatch):
    """Oldest first, one status per night, a failing night does not stop the rest."""
    svc = SurpriseService()
    nights = [NIGHT, NIGHT + timedelta(days=1), NIGHT + timedelta(days=2)]
    monkeypatch.setattr(surprise_service.schedule_service, "get_season_start_date", _async_return(NIGHT))
    monkeypatch.setattr(svc._db, "get_unscored_processed_nights", _async_return(nights))
    scored: list[date] = []

    async def _compute(game_date):
        scored.append(game_date)
        if game_date == nights[1]:
            raise RuntimeError("espn down")
        return "processed"

    monkeypatch.setattr(svc, "compute_and_store", _compute)
    assert await svc.backfill_missing() == {nights[0]: "processed", nights[1]: "failed", nights[2]: "processed"}
    assert scored == nights


@pytest.mark.asyncio
async def test_backfill_with_nothing_missing_scores_nothing(monkeypatch):
    svc = SurpriseService()
    monkeypatch.setattr(surprise_service.schedule_service, "get_season_start_date", _async_return(NIGHT))
    monkeypatch.setattr(svc._db, "get_unscored_processed_nights", _async_return([]))
    monkeypatch.setattr(svc, "compute_and_store", _async_return(pytest.fail))
    assert await svc.backfill_missing() == {}

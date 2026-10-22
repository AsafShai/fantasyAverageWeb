from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd
import pytest

from app.config import settings
from app.services import surprise_service
from app.services.surprise_service import SurpriseService, score_night
from model_stats_inference.serving import surprise

NIGHT = date(2025, 12, 1)


@pytest.fixture(autouse=True)
def _no_team_name_lookup(monkeypatch):
    """The read side looks up fantasy team names through DataProvider (ESPN);
    tests get a fixed map instead."""
    async def names(self):
        return {7: "Trust the process"}
    monkeypatch.setattr(SurpriseService, "_team_names", names)


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
            "game_id": "g1" if pid % 2 else "g2", "game_date": NIGHT, "player_id": pid, "player_name": f"P{pid}",
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


@pytest.mark.asyncio
async def test_period_ranks_player_nights_against_the_range(monkeypatch):
    """The DB hands back the rows past the cuts; the service splits them by
    sign (busts worst first), keeps each row's own night, and reports the
    percentiles asked for and the scores they fell on, as magnitudes."""
    created = datetime(2025, 12, 3, 9, 0)

    def row(pid, night, score):
        return {
            "game_id": f"g{pid}", "game_date": night, "player_id": pid, "player_name": f"P{pid}",
            "team_id": 2, "opponent_team_id": 18, "is_home": False, "minutes": 30.0,
            **{s.lower(): 1.0 for s in ["PTS", "REB", "AST", "FG3M", "STL", "BLK", "FGM", "FGA", "FTM", "FTA"]},
            "metric_z": score, "metric_err": None, "score": score, "has_estimate": True,
            "verdict": "", "reasons": [], "created_at": created,
            "fantasy_team_id": None, "fantasy_team": None, "lineup_slot": None,
        }

    later = NIGHT + timedelta(days=1)
    summary = {"players_played": 300, "players_scored": 280, "players_with_estimate": 270, "games": 14,
               "nights": 2, "computed_at": created, "good_cut": 1.37, "bad_cut": -1.23}
    asked = {}

    async def fake_period(start, end, good_q, bad_q):
        asked.update(start=start, end=end, good_q=good_q, bad_q=bad_q)
        return summary, [row(1, NIGHT, 2.6), row(2, later, 1.5), row(3, later, -1.3), row(4, NIGHT, -2.1)]

    svc = SurpriseService()
    monkeypatch.setattr(svc._db, "get_surprise_period", fake_period)
    out = await svc.period(NIGHT, later, 95.0, 90.0)

    assert asked == {"start": NIGHT, "end": later, "good_q": 0.95, "bad_q": pytest.approx(0.10)}
    assert out["start"] == "2025-12-01" and out["end"] == "2025-12-02"
    assert (out["nights"], out["games"], out["players_scored"]) == (2, 14, 280)
    assert out["percentiles"] == {"good": 95.0, "bad": 90.0}
    assert out["thresholds"] == {"good": 1.37, "bad": 1.23}
    assert [(r["player_id"], r["game_date"]) for r in out["good"]] == [(1, "2025-12-01"), (2, "2025-12-02")]
    assert [r["player_id"] for r in out["bad"]] == [4, 3]   # worst first


@pytest.mark.asyncio
async def test_period_without_rows_is_none(monkeypatch):
    svc = SurpriseService()
    monkeypatch.setattr(svc._db, "get_surprise_period", _async_return((None, [])))
    assert await svc.period(NIGHT, NIGHT + timedelta(days=3), 95.0, 95.0) is None


@pytest.mark.asyncio
async def test_rows_carry_the_fantasy_teams_current_name(monkeypatch):
    """The row keeps the short code and gets the team's current full name;
    a team the lookup doesn't know falls back to the code, a free agent has
    neither."""
    created = datetime(2025, 12, 2, 9, 0)
    base = {
        "game_id": "g", "game_date": NIGHT, "player_name": "P", "team_id": 2, "opponent_team_id": 18,
        "is_home": True, "minutes": 30.0,
        **{s.lower(): 1.0 for s in ["PTS", "REB", "AST", "FG3M", "STL", "BLK", "FGM", "FGA", "FTM", "FTA"]},
        "metric_z": 1.0, "metric_err": None, "has_estimate": True, "verdict": "", "reasons": [], "created_at": created,
    }
    rows = [
        {**base, "player_id": 1, "score": 2.0, "fantasy_team_id": 7, "fantasy_team": "HHT", "lineup_slot": "PG"},
        {**base, "player_id": 2, "score": 1.5, "fantasy_team_id": 99, "fantasy_team": "NEW", "lineup_slot": "BE"},
        {**base, "player_id": 3, "score": 1.0, "fantasy_team_id": None, "fantasy_team": None, "lineup_slot": None},
    ]
    svc = SurpriseService()
    monkeypatch.setattr(svc._db, "get_surprises_for_date", _async_return(rows))
    monkeypatch.setattr(svc._db, "get_latest_model_nightly_run", _async_return(None))
    out = await svc.night(NIGHT)
    got = {r["player_id"]: (r["fantasy_team"], r["fantasy_team_name"]) for r in out["good"]}
    assert got == {1: ("HHT", "Trust the process"), 2: ("NEW", "NEW"), 3: (None, None)}


@pytest.mark.asyncio
async def test_form_combines_each_players_nights(monkeypatch):
    """One row per player: score = sum / sqrt(games) (stays on the night's
    scale), avg_score the plain average, the line per game, the latest
    night's teams with the fantasy team's name."""
    created = datetime(2025, 12, 3, 9, 0)

    def grouped(pid, games, score_sum, team_id=7):
        return {
            "player_id": pid, "game_date": NIGHT + timedelta(days=games), "player_name": f"P{pid}", "team_id": 2,
            "fantasy_team": "HHT" if team_id else None, "fantasy_team_id": team_id,
            "games": games, "score_sum": score_sum, "has_estimate": True,
            "minutes": 30.0 * games, **{s.lower(): 10.0 * games for s in ["PTS", "REB", "AST", "FG3M", "STL", "BLK", "FGM", "FGA", "FTM", "FTA"]},
        }

    summary = {"games": 20, "nights": 4, "players_played": 120, "players_scored": 110,
               "players_with_estimate": 100, "computed_at": created}
    # three steady +1.2 nights beat one lucky +2.0 night: 3.6 / sqrt(3) = 2.08
    rows = [grouped(1, 3, 3.6), grouped(2, 1, 2.0), grouped(3, 4, -4.0, team_id=None)]
    svc = SurpriseService()
    monkeypatch.setattr(svc._db, "get_surprise_form", _async_return((summary, rows)))
    out = await svc.form(NIGHT, NIGHT + timedelta(days=6))

    assert (out["nights"], out["games"], out["players_scored"]) == (4, 20, 110)
    assert [r["player_id"] for r in out["good"]] == [1, 2]
    steady, lucky = out["good"]
    assert steady["score"] == pytest.approx(3.6 / 3 ** 0.5) and steady["avg_score"] == pytest.approx(1.2)
    assert lucky["score"] == pytest.approx(2.0) and lucky["avg_score"] == pytest.approx(2.0)
    assert (steady["games"], steady["pts"], steady["minutes"]) == (3, 10.0, 30.0)
    assert (steady["fantasy_team_id"], steady["fantasy_team_name"]) == (7, "Trust the process")
    assert steady["game_date"] == (NIGHT + timedelta(days=3)).isoformat()
    (bust,) = out["bad"]
    assert bust["score"] == pytest.approx(-2.0) and bust["fantasy_team_name"] is None


@pytest.mark.asyncio
async def test_form_without_rows_is_none(monkeypatch):
    svc = SurpriseService()
    monkeypatch.setattr(svc._db, "get_surprise_form", _async_return(({"players_scored": 0}, [])))
    assert await svc.form(NIGHT, NIGHT) is None

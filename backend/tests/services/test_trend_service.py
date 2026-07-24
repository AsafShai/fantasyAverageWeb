from datetime import date, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pandas as pd
import pytest

from app.config import settings
from app.services.trend_service import (
    TrendService,
    build_game_log,
    classify_role_badge,
    compute_minutes_movers,
    compute_regression_groups,
    compute_usage_role,
    prior_season_strings,
)


def _current_row(player_id, player_name, gp, fg3m=0, fg3a=0, ftm=0, fta=0, fgm=0, fga=0):
    return {
        "player_id": player_id, "player_name": player_name, "gp": gp,
        "fg3m": fg3m, "fg3a": fg3a, "fg3_pct": (fg3m / fg3a) if fg3a else 0.0,
        "ftm": ftm, "fta": fta, "ft_pct": (ftm / fta) if fta else 0.0,
        "fgm": fgm, "fga": fga, "fg_pct": (fgm / fga) if fga else 0.0,
    }


def _players_df(rows):
    return pd.DataFrame(rows)


def test_qualifying_stat_computes_dev_and_drift():
    # Cold 3P%: current 33.1% on 8.4 att/g (420 attempts over 50 games),
    # baseline 41.2% on heavy volume — large volume, large dev, should qualify.
    current = pd.DataFrame([_current_row(1, "Klay Thompson", 50, fg3m=139, fg3a=420)])
    baseline = pd.DataFrame([_current_row(1, "Klay Thompson", 100, fg3m=350, fg3a=850)])
    players_df = _players_df([{
        "Name": "Klay Thompson", "Pro Team": "DAL", "Positions": "SG",
        "status": "FREEAGENT", "fantasy_team_name": None,
    }])

    groups = compute_regression_groups(current, baseline, {1: 6}, players_df)

    assert len(groups) == 1
    group = groups[0]
    assert group.player_name == "Klay Thompson"
    assert group.pro_team == "DAL"
    assert group.position == "SG"
    assert group.fantasy_status == "FA"
    assert group.games_last_15d == 6
    assert len(group.stats) == 1
    stat = group.stats[0]
    assert stat.stat == "3P%"
    current_pct = 139 / 420 * 100
    baseline_pct = 350 / 850 * 100
    assert stat.current_pct == pytest.approx(current_pct)
    assert stat.baseline_pct == pytest.approx(baseline_pct)
    assert stat.dev == pytest.approx(current_pct - baseline_pct)
    assert stat.attempts_per_game == pytest.approx(420 / 50)


def test_volume_gate_excludes_low_current_attempts():
    # Only 20 current 3PA (< 40 gate) despite a real baseline — excluded.
    current = pd.DataFrame([_current_row(1, "Player One", 50, fg3m=5, fg3a=20)])
    baseline = pd.DataFrame([_current_row(1, "Player One", 100, fg3m=300, fg3a=800)])
    players_df = _players_df([{
        "Name": "Player One", "Pro Team": "LAL", "Positions": "PG",
        "status": "ONTEAM", "fantasy_team_name": "Team Rocket",
    }])

    groups = compute_regression_groups(current, baseline, {1: 5}, players_df)

    assert groups == []


def test_volume_gate_excludes_low_baseline_attempts():
    # Heavy current volume but thin baseline (<150 3PA) — excluded, baseline unreliable.
    current = pd.DataFrame([_current_row(1, "Player Two", 50, fg3m=140, fg3a=420)])
    baseline = pd.DataFrame([_current_row(1, "Player Two", 20, fg3m=30, fg3a=100)])
    players_df = _players_df([{
        "Name": "Player Two", "Pro Team": "BOS", "Positions": "SF",
        "status": "FREEAGENT", "fantasy_team_name": None,
    }])

    groups = compute_regression_groups(current, baseline, {1: 5}, players_df)

    assert groups == []


def test_drift_threshold_excludes_big_pp_swing_on_low_volume():
    # -14pp FT% dev, but only ~2.1 FTA/g -> drift_score well under 0.35 -> excluded.
    current = pd.DataFrame([_current_row(1, "Low Volume FT", 50, ftm=82, fta=105)])
    baseline = pd.DataFrame([_current_row(1, "Low Volume FT", 100, ftm=350, fta=380)])
    players_df = _players_df([{
        "Name": "Low Volume FT", "Pro Team": "DAL", "Positions": "SG",
        "status": "FREEAGENT", "fantasy_team_name": None,
    }])

    groups = compute_regression_groups(current, baseline, {1: 6}, players_df)

    assert groups == []


def test_drift_threshold_includes_modest_pp_swing_on_high_volume():
    # -3.2pp FG% dev on 14.2 FGA/g -> drift_score ~0.45 -> qualifies despite
    # being under any flat-pp threshold like 3.5pp.
    fga_per_g = 14.2
    gp = 50
    fga = fga_per_g * gp
    current = pd.DataFrame([_current_row(1, "High Volume FG", gp, fgm=fga * 0.548, fga=fga)])
    baseline = pd.DataFrame([_current_row(1, "High Volume FG", 100, fgm=580 * 0.58, fga=1000)])
    players_df = _players_df([{
        "Name": "High Volume FG", "Pro Team": "CHI", "Positions": "C",
        "status": "ONTEAM", "fantasy_team_name": "Hoop Dreams",
    }])

    groups = compute_regression_groups(current, baseline, {1: 7}, players_df)

    assert len(groups) == 1
    assert groups[0].stats[0].stat == "FG%"


def test_multi_stat_player_grouped_and_sorted_by_abs_dev_desc():
    # Two independently qualifying stats for the same player: 3P% has the
    # bigger |dev| (~8.1pp) than FG% (~3.2pp) -> 3P% must sort first.
    current = pd.DataFrame([_current_row(
        1, "Two Stat Player", 50, fg3m=139, fg3a=420, fgm=389.08, fga=710,
    )])
    baseline = pd.DataFrame([_current_row(
        1, "Two Stat Player", 100, fg3m=350, fg3a=850, fgm=580, fga=1000,
    )])
    players_df = _players_df([{
        "Name": "Two Stat Player", "Pro Team": "CHI", "Positions": "C",
        "status": "FREEAGENT", "fantasy_team_name": None,
    }])

    groups = compute_regression_groups(current, baseline, {1: 6}, players_df)

    assert len(groups) == 1
    stats = groups[0].stats
    assert [s.stat for s in stats] == ["3P%", "FG%"]
    assert abs(stats[0].dev) > abs(stats[1].dev)


def test_player_missing_from_baseline_is_excluded():
    current = pd.DataFrame([_current_row(1, "Rookie Player", 50, fg3m=139, fg3a=420)])
    baseline = pd.DataFrame(columns=[
        "player_id", "player_name", "gp", "fg3m", "fg3a", "fg3_pct",
        "ftm", "fta", "ft_pct", "fgm", "fga", "fg_pct",
    ])
    players_df = _players_df([{
        "Name": "Rookie Player", "Pro Team": "SAC", "Positions": "PF",
        "status": "FREEAGENT", "fantasy_team_name": None,
    }])

    groups = compute_regression_groups(current, baseline, {1: 6}, players_df)

    assert groups == []


def test_player_without_espn_match_is_skipped():
    current = pd.DataFrame([_current_row(1, "Unknown To ESPN", 50, fg3m=139, fg3a=420)])
    baseline = pd.DataFrame([_current_row(1, "Unknown To ESPN", 100, fg3m=350, fg3a=850)])
    players_df = _players_df([{
        "Name": "Someone Else Entirely", "Pro Team": "MIA", "Positions": "PG",
        "status": "FREEAGENT", "fantasy_team_name": None,
    }])

    groups = compute_regression_groups(current, baseline, {1: 6}, players_df)

    assert groups == []


def test_fantasy_status_uses_team_name_when_rostered():
    current = pd.DataFrame([_current_row(1, "Rostered Player", 50, fg3m=139, fg3a=420)])
    baseline = pd.DataFrame([_current_row(1, "Rostered Player", 100, fg3m=350, fg3a=850)])
    players_df = _players_df([{
        "Name": "Rostered Player", "Pro Team": "NYK", "Positions": "SF",
        "status": "ONTEAM", "fantasy_team_name": "Splash Zone",
    }])

    groups = compute_regression_groups(current, baseline, {1: 6}, players_df)

    assert groups[0].fantasy_status == "Splash Zone"


def test_missing_games_last_15d_defaults_to_zero():
    current = pd.DataFrame([_current_row(1, "No Recency Data", 50, fg3m=139, fg3a=420)])
    baseline = pd.DataFrame([_current_row(1, "No Recency Data", 100, fg3m=350, fg3a=850)])
    players_df = _players_df([{
        "Name": "No Recency Data", "Pro Team": "PHX", "Positions": "SG",
        "status": "FREEAGENT", "fantasy_team_name": None,
    }])

    groups = compute_regression_groups(current, baseline, {}, players_df)

    assert groups[0].games_last_15d == 0


@pytest.fixture
def service():
    return TrendService()


@pytest.mark.asyncio
async def test_get_shooting_regression_wires_db_calls_and_returns_response(service):
    empty_df = pd.DataFrame()
    players_df = pd.DataFrame([{
        "Name": "Klay Thompson", "Pro Team": "DAL", "Positions": "SG",
        "status": "FREEAGENT", "fantasy_team_name": None,
    }])

    with patch.object(service, "_db") as mock_db, \
         patch("app.services.trend_service.get_season_anchor_date", new_callable=AsyncMock) as mock_anchor:
        mock_anchor.return_value = date(2026, 6, 1)
        mock_db.aggregate_shooting_by_player = AsyncMock(return_value=empty_df)
        mock_db.get_games_since = AsyncMock(return_value={})

        response = await service.get_shooting_regression(players_df)

        assert response.items == []
        assert mock_db.aggregate_shooting_by_player.call_count == 2
        current_call, baseline_call = mock_db.aggregate_shooting_by_player.call_args_list
        assert current_call.args[0] == ["2025-26"]
        assert baseline_call.args[0] == ["2024-25", "2023-24"]
        mock_db.get_games_since.assert_awaited_once_with(date(2026, 5, 17))


@pytest.mark.asyncio
async def test_get_shooting_regression_uses_cache_within_ttl(service):
    players_df = pd.DataFrame([{
        "Name": "Klay Thompson", "Pro Team": "DAL", "Positions": "SG",
        "status": "FREEAGENT", "fantasy_team_name": None,
    }])

    with patch.object(service, "_db") as mock_db, \
         patch("app.services.trend_service.get_season_anchor_date", new_callable=AsyncMock) as mock_anchor:
        mock_anchor.return_value = date(2026, 6, 1)
        mock_db.aggregate_shooting_by_player = AsyncMock(return_value=pd.DataFrame())
        mock_db.get_games_since = AsyncMock(return_value={})

        await service.get_shooting_regression(players_df)
        await service.get_shooting_regression(players_df)

        assert mock_db.aggregate_shooting_by_player.call_count == 2  # only the first call


@pytest.mark.asyncio
async def test_get_shooting_regression_recomputes_after_ttl_expires(service):
    players_df = pd.DataFrame([{
        "Name": "Klay Thompson", "Pro Team": "DAL", "Positions": "SG",
        "status": "FREEAGENT", "fantasy_team_name": None,
    }])

    with patch.object(service, "_db") as mock_db, \
         patch("app.services.trend_service.get_season_anchor_date", new_callable=AsyncMock) as mock_anchor:
        mock_anchor.return_value = date(2026, 6, 1)
        mock_db.aggregate_shooting_by_player = AsyncMock(return_value=pd.DataFrame())
        mock_db.get_games_since = AsyncMock(return_value={})

        await service.get_shooting_regression(players_df)
        service._regression_cache[(15, 2)]['ts'] = datetime.now() - timedelta(hours=7)
        await service.get_shooting_regression(players_df)

        assert mock_db.aggregate_shooting_by_player.call_count == 4  # two calls, twice


def _season_row(player_id, player_name, gp, min_total):
    return {"player_id": player_id, "player_name": player_name, "gp": gp, "min": min_total}


def _window_row(player_id, window_gp, window_avg_min):
    return {"player_id": player_id, "gp": window_gp, "min": window_gp * window_avg_min}


def test_minutes_qualifying_player_computes_mpg_and_delta():
    season_df = pd.DataFrame([_season_row(1, "Ayo Dosunmu", 48, 48 * 24.1)])
    window_df = pd.DataFrame([_window_row(1, 5, 31.8)])
    players_df = pd.DataFrame([{
        "Name": "Ayo Dosunmu", "Pro Team": "CHI", "Positions": "PG",
        "status": "FREEAGENT", "fantasy_team_name": None,
    }])

    items = compute_minutes_movers(season_df, window_df, {1: 7}, players_df)

    assert len(items) == 1
    item = items[0]
    assert item.player_name == "Ayo Dosunmu"
    assert item.season_mpg == pytest.approx(24.1)
    assert item.l5_mpg == pytest.approx(31.8)
    assert item.delta_mpg == pytest.approx(31.8 - 24.1)
    assert item.season_gp == 48
    assert item.window_gp == 5
    assert item.low_sample is False
    assert item.fantasy_status == "FA"
    assert item.games_last_15d == 7


def test_minutes_excludes_below_season_gp_gate():
    season_df = pd.DataFrame([_season_row(1, "Rookie", 8, 8 * 20.0)])  # < 10 gate
    window_df = pd.DataFrame([_window_row(1, 5, 25.0)])
    players_df = pd.DataFrame([{
        "Name": "Rookie", "Pro Team": "SAC", "Positions": "SF",
        "status": "FREEAGENT", "fantasy_team_name": None,
    }])

    items = compute_minutes_movers(season_df, window_df, {1: 5}, players_df)

    assert items == []


def test_minutes_excludes_below_window_gp_gate():
    season_df = pd.DataFrame([_season_row(1, "Just Back", 40, 40 * 20.0)])
    window_df = pd.DataFrame([_window_row(1, 1, 25.0)])  # < 2 gate
    players_df = pd.DataFrame([{
        "Name": "Just Back", "Pro Team": "SAC", "Positions": "SF",
        "status": "FREEAGENT", "fantasy_team_name": None,
    }])

    items = compute_minutes_movers(season_df, window_df, {1: 3}, players_df)

    assert items == []


def test_minutes_low_sample_badge_when_window_partial():
    season_df = pd.DataFrame([_season_row(1, "Partial Window", 40, 40 * 20.0)])
    window_df = pd.DataFrame([_window_row(1, 2, 25.0)])  # eligible (>=2) but partial (<5)
    players_df = pd.DataFrame([{
        "Name": "Partial Window", "Pro Team": "SAC", "Positions": "SF",
        "status": "FREEAGENT", "fantasy_team_name": None,
    }])

    items = compute_minutes_movers(season_df, window_df, {1: 3}, players_df)

    assert items[0].low_sample is True


def test_minutes_player_without_window_row_is_skipped():
    season_df = pd.DataFrame([_season_row(1, "No Window Data", 40, 40 * 20.0)])
    window_df = pd.DataFrame(columns=["player_id", "gp", "min"])
    players_df = pd.DataFrame([{
        "Name": "No Window Data", "Pro Team": "SAC", "Positions": "SF",
        "status": "FREEAGENT", "fantasy_team_name": None,
    }])

    items = compute_minutes_movers(season_df, window_df, {}, players_df)

    assert items == []


def test_minutes_player_without_espn_match_is_skipped():
    season_df = pd.DataFrame([_season_row(1, "Unknown To ESPN", 40, 40 * 20.0)])
    window_df = pd.DataFrame([_window_row(1, 5, 25.0)])
    players_df = pd.DataFrame([{
        "Name": "Someone Else", "Pro Team": "SAC", "Positions": "SF",
        "status": "FREEAGENT", "fantasy_team_name": None,
    }])

    items = compute_minutes_movers(season_df, window_df, {}, players_df)

    assert items == []


def test_minutes_fantasy_status_uses_team_name_when_rostered():
    season_df = pd.DataFrame([_season_row(1, "Rostered Player", 40, 40 * 20.0)])
    window_df = pd.DataFrame([_window_row(1, 5, 25.0)])
    players_df = pd.DataFrame([{
        "Name": "Rostered Player", "Pro Team": "NYK", "Positions": "SF",
        "status": "ONTEAM", "fantasy_team_name": "Splash Zone",
    }])

    items = compute_minutes_movers(season_df, window_df, {}, players_df)

    assert items[0].fantasy_status == "Splash Zone"


def test_minutes_sorted_by_abs_delta_desc():
    season_df = pd.DataFrame([
        _season_row(1, "Small Mover", 40, 40 * 20.0),
        _season_row(2, "Big Mover", 40, 40 * 20.0),
    ])
    window_df = pd.DataFrame([
        _window_row(1, 5, 21.0),  # delta +1
        _window_row(2, 5, 30.0),  # delta +10
    ])
    players_df = pd.DataFrame([
        {"Name": "Small Mover", "Pro Team": "SAC", "Positions": "SF", "status": "FREEAGENT", "fantasy_team_name": None},
        {"Name": "Big Mover", "Pro Team": "SAC", "Positions": "SF", "status": "FREEAGENT", "fantasy_team_name": None},
    ])

    items = compute_minutes_movers(season_df, window_df, {}, players_df)

    assert [i.player_name for i in items] == ["Big Mover", "Small Mover"]


@pytest.mark.asyncio
async def test_get_minutes_movers_wires_db_calls_and_returns_response(service):
    players_df = pd.DataFrame([{
        "Name": "Ayo Dosunmu", "Pro Team": "CHI", "Positions": "PG",
        "status": "FREEAGENT", "fantasy_team_name": None,
    }])

    with patch.object(service, "_db") as mock_db, \
         patch("app.services.trend_service.get_season_anchor_date", new_callable=AsyncMock) as mock_anchor:
        mock_anchor.return_value = date(2026, 6, 1)
        mock_db.aggregate_shooting_by_player = AsyncMock(return_value=pd.DataFrame())
        mock_db.get_games_since = AsyncMock(return_value={})

        response = await service.get_minutes_movers(players_df)

        assert response.items == []
        assert mock_db.aggregate_shooting_by_player.call_count == 2
        season_call, window_call = mock_db.aggregate_shooting_by_player.call_args_list
        assert season_call.args[0] == ["2025-26"]
        assert season_call.kwargs["end"] == date(2026, 6, 1)
        assert window_call.args[0] == ["2025-26"]
        assert window_call.kwargs["start"] == date(2026, 5, 17)
        assert window_call.kwargs["end"] == date(2026, 6, 1)
        mock_db.get_games_since.assert_awaited_once_with(date(2026, 5, 17))


@pytest.mark.asyncio
async def test_get_minutes_movers_uses_cache_within_ttl(service):
    players_df = pd.DataFrame([{
        "Name": "Ayo Dosunmu", "Pro Team": "CHI", "Positions": "PG",
        "status": "FREEAGENT", "fantasy_team_name": None,
    }])

    with patch.object(service, "_db") as mock_db, \
         patch("app.services.trend_service.get_season_anchor_date", new_callable=AsyncMock) as mock_anchor:
        mock_anchor.return_value = date(2026, 6, 1)
        mock_db.aggregate_shooting_by_player = AsyncMock(return_value=pd.DataFrame())
        mock_db.get_games_since = AsyncMock(return_value={})

        await service.get_minutes_movers(players_df)
        await service.get_minutes_movers(players_df)

        assert mock_db.aggregate_shooting_by_player.call_count == 2


@pytest.mark.parametrize("delta_mpg,delta_usg,expected", [
    (5.0, 3.0, "Role ↑"),
    (4.0, 2.0, "Role ↑"),  # boundary: exactly at both thresholds
    (5.0, 0.0, "Minutes ↑"),
    (0.0, 4.0, "Usage ↑"),
    (0.0, 3.0, "Usage ↑"),  # boundary
    (-5.0, -3.0, "Role ↓"),
    (-5.0, 0.0, "Minutes ↓"),
    (0.0, -4.0, "Usage ↓"),
    (1.0, 1.0, None),
    (0.0, 0.0, None),
])
def test_classify_role_badge(delta_mpg, delta_usg, expected):
    assert classify_role_badge(delta_mpg, delta_usg) == expected


def _usage_row(player_id, player_name, game_date, fga, min_, fta=0.0, tov=0.0,
                t_fga=100.0, t_fta=0.0, t_tov=0.0, t_min=240.0):
    return {
        "player_id": player_id, "player_name": player_name,
        "game_id": f"G{game_date.isoformat()}", "game_date": game_date,
        "p_min": min_, "p_fga": fga, "p_fta": fta, "p_tov": tov,
        "t_fga": t_fga, "t_fta": t_fta, "t_tov": t_tov, "t_min": t_min,
    }


def _usage_games_df(player_id, player_name, older_five, recent_five):
    """older_five/recent_five: 5 (fga, min) tuples each. With fta=tov=0,
    t_fga=100, t_min=240 (this file's fixed defaults), usg reduces to
    48 * fga / min — easy to hand-verify."""
    base = date(2026, 1, 1)
    rows = [
        _usage_row(player_id, player_name, base + timedelta(days=i), fga, min_)
        for i, (fga, min_) in enumerate(older_five)
    ]
    rows += [
        _usage_row(player_id, player_name, base + timedelta(days=20 + i), fga, min_)
        for i, (fga, min_) in enumerate(recent_five)
    ]
    return pd.DataFrame(rows)


def test_usage_qualifying_player_computes_correct_averages():
    games_df = _usage_games_df(
        1, "Ayo Dosunmu",
        older_five=[(10, 30)] * 5,   # usg = 48*10/30 = 16.0, min=30
        recent_five=[(15, 32)] * 5,  # usg = 48*15/32 = 22.5, min=32
    )
    players_df = pd.DataFrame([{
        "Name": "Ayo Dosunmu", "Pro Team": "CHI", "Positions": "PG",
        "status": "FREEAGENT", "fantasy_team_name": None,
    }])

    items = compute_usage_role(games_df, {1: 7}, players_df, date(2026, 1, 16))

    assert len(items) == 1
    item = items[0]
    assert item.season_usg == pytest.approx((5 * 16.0 + 5 * 22.5) / 10)
    assert item.l5_usg == pytest.approx(22.5)
    assert item.delta_usg == pytest.approx(22.5 - (5 * 16.0 + 5 * 22.5) / 10)
    assert item.season_mpg == pytest.approx((5 * 30 + 5 * 32) / 10)
    assert item.l5_mpg == pytest.approx(32.0)
    assert item.season_gp == 10
    assert item.window_gp == 5
    assert item.role_badge == "Usage ↑"  # delta_usg ~3.25 >= 3.0, delta_mpg ~1.0 < 4.0
    assert item.games_last_15d == 7


def test_usage_excludes_below_season_gp_gate():
    games_df = _usage_games_df(
        1, "Too Few Games",
        older_five=[(10, 30)] * 3, recent_five=[(15, 32)] * 3,
    )  # only 6 total games, < 10 gate
    players_df = pd.DataFrame([{
        "Name": "Too Few Games", "Pro Team": "CHI", "Positions": "PG",
        "status": "FREEAGENT", "fantasy_team_name": None,
    }])

    items = compute_usage_role(games_df, {}, players_df, date(2026, 1, 16))

    assert items == []


def test_usage_skips_player_without_espn_match():
    games_df = _usage_games_df(1, "Unknown To ESPN", [(10, 30)] * 5, [(15, 32)] * 5)
    players_df = pd.DataFrame([{
        "Name": "Someone Else", "Pro Team": "CHI", "Positions": "PG",
        "status": "FREEAGENT", "fantasy_team_name": None,
    }])

    items = compute_usage_role(games_df, {}, players_df, date(2026, 1, 16))

    assert items == []


def test_usage_fantasy_status_uses_team_name_when_rostered():
    games_df = _usage_games_df(1, "Rostered Player", [(10, 30)] * 5, [(15, 32)] * 5)
    players_df = pd.DataFrame([{
        "Name": "Rostered Player", "Pro Team": "NYK", "Positions": "SF",
        "status": "ONTEAM", "fantasy_team_name": "Splash Zone",
    }])

    items = compute_usage_role(games_df, {}, players_df, date(2026, 1, 16))

    assert items[0].fantasy_status == "Splash Zone"


def test_usage_missing_games_last_15d_defaults_to_zero():
    games_df = _usage_games_df(1, "No Recency Data", [(10, 30)] * 5, [(15, 32)] * 5)
    players_df = pd.DataFrame([{
        "Name": "No Recency Data", "Pro Team": "CHI", "Positions": "PG",
        "status": "FREEAGENT", "fantasy_team_name": None,
    }])

    items = compute_usage_role(games_df, {}, players_df, date(2026, 1, 16))

    assert items[0].games_last_15d == 0


def test_usage_sorted_by_abs_delta_usg_desc():
    small_mover = _usage_games_df(1, "Small Mover", [(10, 30)] * 5, [(10, 30)] * 5)  # delta_usg = 0
    big_mover = _usage_games_df(2, "Big Mover", [(10, 30)] * 5, [(20, 30)] * 5)  # big delta_usg
    games_df = pd.concat([small_mover, big_mover], ignore_index=True)
    players_df = pd.DataFrame([
        {"Name": "Small Mover", "Pro Team": "CHI", "Positions": "PG", "status": "FREEAGENT", "fantasy_team_name": None},
        {"Name": "Big Mover", "Pro Team": "CHI", "Positions": "PG", "status": "FREEAGENT", "fantasy_team_name": None},
    ])

    items = compute_usage_role(games_df, {}, players_df, date(2026, 1, 16))

    assert [i.player_name for i in items] == ["Big Mover", "Small Mover"]


def test_usage_empty_games_df_returns_empty_list():
    empty = pd.DataFrame(columns=[
        "player_id", "player_name", "game_id", "game_date",
        "p_min", "p_fga", "p_fta", "p_tov", "t_fga", "t_fta", "t_tov", "t_min",
    ])
    items = compute_usage_role(empty, {}, pd.DataFrame(), date(2026, 1, 16))
    assert items == []


@pytest.mark.asyncio
async def test_get_usage_role_wires_db_calls_and_returns_response(service):
    players_df = pd.DataFrame([{
        "Name": "Ayo Dosunmu", "Pro Team": "CHI", "Positions": "PG",
        "status": "FREEAGENT", "fantasy_team_name": None,
    }])

    with patch.object(service, "_db") as mock_db, \
         patch("app.services.trend_service.get_season_anchor_date", new_callable=AsyncMock) as mock_anchor:
        mock_anchor.return_value = date(2026, 6, 1)
        mock_db.get_usage_components = AsyncMock(return_value=pd.DataFrame())
        mock_db.get_games_since = AsyncMock(return_value={})

        response = await service.get_usage_role(players_df)

        assert response.items == []
        mock_db.get_usage_components.assert_awaited_once_with("2025-26", settings.season_start, date(2026, 6, 1))
        mock_db.get_games_since.assert_awaited_once_with(date(2026, 5, 17))


@pytest.mark.asyncio
async def test_get_usage_role_uses_cache_within_ttl(service):
    players_df = pd.DataFrame([{
        "Name": "Ayo Dosunmu", "Pro Team": "CHI", "Positions": "PG",
        "status": "FREEAGENT", "fantasy_team_name": None,
    }])

    with patch.object(service, "_db") as mock_db, \
         patch("app.services.trend_service.get_season_anchor_date", new_callable=AsyncMock) as mock_anchor:
        mock_anchor.return_value = date(2026, 6, 1)
        mock_db.get_usage_components = AsyncMock(return_value=pd.DataFrame())
        mock_db.get_games_since = AsyncMock(return_value={})

        await service.get_usage_role(players_df)
        await service.get_usage_role(players_df)

        assert mock_db.get_usage_components.call_count == 1


def _one_season_baseline_case():
    """~90 baseline 3PA: passes the 1-season gate (75), fails the 2-season one (150)."""
    current = pd.DataFrame([_current_row(1, "Thin Baseline", 50, fg3m=120, fg3a=400)])
    baseline = pd.DataFrame([_current_row(1, "Thin Baseline", 30, fg3m=36, fg3a=90)])
    players_df = _players_df([{
        "Name": "Thin Baseline", "Pro Team": "PHX", "Positions": "SG",
        "status": "FREEAGENT", "fantasy_team_name": None,
    }])
    return current, baseline, players_df


def test_baseline_gate_scales_down_for_one_season_baseline():
    current, baseline, players_df = _one_season_baseline_case()

    assert compute_regression_groups(current, baseline, {1: 5}, players_df, baseline_seasons=2) == []
    groups = compute_regression_groups(current, baseline, {1: 5}, players_df, baseline_seasons=1)

    assert len(groups) == 1
    assert groups[0].stats[0].stat == "3P%"


def test_prior_season_strings_length_follows_baseline_seasons():
    with patch.object(settings, "season_id", 2026):
        assert prior_season_strings(1) == ["2024-25"]
        assert prior_season_strings(2) == ["2024-25", "2023-24"]


def test_regression_items_carry_player_id():
    current = pd.DataFrame([_current_row(77, "Id Carrier", 50, fg3m=140, fg3a=420)])
    baseline = pd.DataFrame([_current_row(77, "Id Carrier", 100, fg3m=320, fg3a=800)])
    players_df = _players_df([{
        "Name": "Id Carrier", "Pro Team": "MIA", "Positions": "SF",
        "status": "FREEAGENT", "fantasy_team_name": None,
    }])

    groups = compute_regression_groups(current, baseline, {77: 5}, players_df)

    assert groups[0].player_id == 77


def test_rostered_players_are_no_longer_filtered_out():
    current = pd.DataFrame([_current_row(1, "Rostered Guy", 50, fg3m=140, fg3a=420)])
    baseline = pd.DataFrame([_current_row(1, "Rostered Guy", 100, fg3m=320, fg3a=800)])
    players_df = _players_df([{
        "Name": "Rostered Guy", "Pro Team": "BOS", "Positions": "SF",
        "status": "ONTEAM", "fantasy_team_name": "Team Rocket",
    }])

    groups = compute_regression_groups(current, baseline, {1: 5}, players_df)

    assert [g.fantasy_status for g in groups] == ["Team Rocket"]


def _game_log_row(game_date, p_min, fgm, fga, ftm, fta, fg3m, fg3a, tov=2.0):
    return {
        "player_name": "Log Guy", "game_date": game_date, "matchup": "BOS vs. MIA",
        "p_min": p_min, "fgm": fgm, "fga": fga, "ftm": ftm, "fta": fta,
        "fg3m": fg3m, "fg3a": fg3a,
        "p_fga": fga, "p_fta": fta, "p_tov": tov,
        "t_fga": 88.0, "t_fta": 20.0, "t_tov": 13.0, "t_min": 240.0,
    }


def test_build_game_log_aggregates_season_percentages_from_totals():
    games_df = pd.DataFrame([
        _game_log_row(date(2026, 6, 1), 30.0, 7, 14, 2, 2, 2, 5),
        _game_log_row(date(2026, 6, 3), 26.0, 5, 12, 4, 6, 1, 3),
    ])

    log = build_game_log(
        games_df, 42, "2025-26", 15, date(2026, 5, 20), {"3P%": 38.0}, 2
    )

    assert log.season_gp == 2
    assert log.season_mpg == pytest.approx(28.0)
    assert log.season_pct["FG%"] == pytest.approx(12 / 26 * 100)
    assert log.season_pct["3P%"] == pytest.approx(3 / 8 * 100)
    assert log.season_pct["FT%"] == pytest.approx(6 / 8 * 100)
    assert log.baseline_pct == {"3P%": 38.0}
    assert log.baseline_seasons == 2


def test_build_game_log_usg_matches_usage_role_formula():
    games_df = pd.DataFrame([_game_log_row(date(2026, 6, 1), 30.0, 7, 14, 2, 2, 2, 5)])

    log = build_game_log(games_df, 42, "2025-26", 15, date(2026, 5, 20), {}, 2)

    expected = 100 * (14 + 0.44 * 2 + 2.0) * (240.0 / 5) / (30.0 * (88.0 + 0.44 * 20.0 + 13.0))
    assert log.games[0].usg == pytest.approx(expected)
    assert log.season_usg == pytest.approx(expected)


def test_build_game_log_preserves_game_order_and_shot_counts():
    games_df = pd.DataFrame([
        _game_log_row(date(2026, 6, 1), 30.0, 7, 14, 2, 2, 2, 5),
        _game_log_row(date(2026, 6, 3), 26.0, 5, 12, 4, 6, 1, 3),
    ])

    log = build_game_log(games_df, 42, "2025-26", 15, date(2026, 5, 20), {}, 2)

    assert [g.game_date for g in log.games] == ["2026-06-01", "2026-06-03"]
    assert [g.fg3a for g in log.games] == [5, 3]

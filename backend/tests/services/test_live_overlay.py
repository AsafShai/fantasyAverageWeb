"""The live overlay: tonight's stat lines summed per team on top of ESPN's
official totals, computed in memory and never stored (plan section 3)."""
import json
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import pytest

from app.services import live_overlay as lo
from app.services.data_transformer import DataTransformer

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"
HOUR_MS = 60 * 60 * 1000


def _line(game_id, period, stats, split=5, source=0):
    return {
        "externalId": str(game_id), "scoringPeriodId": period, "seasonId": 2027,
        "statSplitTypeId": split, "statSourceId": source, "stats": stats,
    }


def _entry(player_id, slot, *lines):
    return {
        "lineupSlotId": slot, "playerId": player_id,
        "playerPoolEntry": {"player": {"id": player_id, "fullName": f"P{player_id}", "stats": list(lines)}},
    }


def _slot_state(**exceeded):
    """statBySlot with every slot under its cap, except the ones given as
    slot_id=exceededOnScoringPeriod."""
    out = {}
    for sid in ("0", "1", "2", "3", "4", "5", "6", "11"):
        on = exceeded.get(f"s{sid}")
        out[sid] = {"statId": 42, "value": 10.0, "limitExceeded": on is not None,
                    "exceededOnScoringPeriod": on or 0}
    return {"statBySlot": out}


def _payload(period=24, entries_by_team=None, slots_by_team=None, standings_updated=None, values=None):
    entries_by_team = entries_by_team or {}
    teams = []
    for tid in (1, 2):
        teams.append({
            "id": tid, "name": f"Team {tid}",
            "valuesByStat": (values or {}).get(tid) or {
                "0": 1000.0, "1": 50.0, "2": 80.0, "3": 200.0, "6": 400.0,
                "13": 400.0, "14": 900.0, "15": 150.0, "16": 200.0, "17": 100.0,
                "19": 400 / 900, "20": 150 / 200, "42": 90.0,
            },
        })
    return {
        "scoringPeriodId": period,
        "status": {"standingsUpdateDate": standings_updated},
        "teams": teams,
        "schedule": [{"teams": [
            {"teamId": tid,
             "cumulativeScore": (slots_by_team or {}).get(tid, _slot_state()),
             "rosterForCurrentScoringPeriod": {"entries": entries_by_team.get(tid, [])}}
            for tid in (1, 2)
        ]}],
    }


GAME_A, GAME_B = "401909976", "401909977"
LINE_10PTS = {"0": 10.0, "13": 4.0, "14": 9.0, "15": 2.0, "16": 2.0, "6": 5.0, "42": 1.0}
LINE_20PTS = {"0": 20.0, "13": 8.0, "14": 12.0, "15": 4.0, "16": 5.0, "3": 7.0, "42": 1.0}


# --- building the overlay ----------------------------------------------------

def test_counts_active_slots_and_skips_bench_and_ir():
    raw = _payload(entries_by_team={1: [
        _entry(11, 0, _line(GAME_A, 24, LINE_10PTS)),     # PG: counts
        _entry(12, 11, _line(GAME_B, 24, LINE_20PTS)),    # UTIL: counts
        _entry(13, 12, _line(GAME_A, 24, LINE_20PTS)),    # BE: never
        _entry(14, 13, _line(GAME_B, 24, LINE_20PTS)),    # IR: never
    ]})
    overlay = lo.build_overlay(raw)
    team = overlay.per_team()[1]
    assert overlay.period == 24
    assert team["PTS"] == 30
    assert team["GP"] == 2
    assert team["FGM"] == 12 and team["FGA"] == 21
    assert 2 not in overlay.per_team()


def test_ignores_lines_from_other_periods_splits_and_projections():
    raw = _payload(entries_by_team={1: [
        _entry(11, 0,
               _line(GAME_A, 23, LINE_20PTS),            # yesterday
               _line(GAME_A, 24, LINE_20PTS, split=0),   # season split
               _line(GAME_A, 24, LINE_20PTS, source=1),  # projection
               _line(GAME_A, 24, LINE_10PTS)),
    ]})
    assert lo.build_overlay(raw).per_team()[1]["PTS"] == 10


def test_player_who_has_not_played_adds_nothing():
    raw = _payload(entries_by_team={1: [_entry(11, 0, _line(GAME_A, 24, {}))]})
    overlay = lo.build_overlay(raw)
    assert overlay.is_empty
    assert overlay.per_team() == {}


def test_derived_stats_on_the_line_are_not_summed():
    line = {**LINE_10PTS, "19": 0.444, "20": 1.0}
    raw = _payload(entries_by_team={1: [_entry(11, 0, _line(GAME_A, 24, line))]})
    team = lo.build_overlay(raw).per_team()[1]
    assert "FG%" not in team and "FT%" not in team


def test_capped_slot_contributes_nothing_after_the_day_it_was_crossed():
    raw = _payload(
        entries_by_team={1: [
            _entry(11, 0, _line(GAME_A, 24, LINE_10PTS)),   # PG capped on period 20
            _entry(12, 1, _line(GAME_A, 24, LINE_20PTS)),   # SG crosses today: whole day counts
        ]},
        slots_by_team={1: _slot_state(s0=20, s1=24)},
    )
    overlay = lo.build_overlay(raw)
    assert overlay.per_team()[1]["PTS"] == 20
    assert overlay.slot_gp[1].get("PG", 0) == 0
    assert overlay.slot_gp[1]["SG"] == 1


def test_slot_gp_counts_games_in_progress_per_slot():
    raw = _payload(entries_by_team={1: [
        _entry(11, 11, _line(GAME_A, 24, LINE_10PTS)),
        _entry(12, 11, _line(GAME_B, 24, LINE_20PTS)),
        _entry(13, 2, _line(GAME_B, 24, LINE_20PTS)),
    ]})
    assert lo.build_overlay(raw).slot_gp[1] == {"UTIL": 2, "SF": 1}


def test_settled_flavour_counts_only_the_given_games():
    raw = _payload(entries_by_team={1: [
        _entry(11, 0, _line(GAME_A, 24, LINE_10PTS)),
        _entry(12, 1, _line(GAME_B, 24, LINE_20PTS)),
    ]})
    overlay = lo.build_overlay(raw)
    assert overlay.per_team(games={GAME_A})[1]["PTS"] == 10
    assert overlay.per_team(games=set()) == {}
    assert overlay.game_ids == frozenset({GAME_A, GAME_B})


def test_version_is_stable_for_the_same_lines_and_moves_when_they_change():
    entries = {1: [_entry(11, 0, _line(GAME_A, 24, LINE_10PTS))]}
    a = lo.build_overlay(_payload(entries_by_team=entries))
    b = lo.build_overlay(_payload(entries_by_team=entries))
    c = lo.build_overlay(_payload(entries_by_team={1: [_entry(11, 0, _line(GAME_A, 24, LINE_20PTS))]}))
    assert a.version == b.version
    assert a.version != c.version


def test_payload_without_schedule_gives_empty_overlay():
    overlay = lo.build_overlay({"scoringPeriodId": 5, "teams": []})
    assert overlay.is_empty and overlay.period == 5


# --- applying it to the official frame --------------------------------------

def _official(raw):
    return DataTransformer().raw_standings_to_totals_df(raw)


def test_empty_overlay_returns_the_same_frame_object():
    raw = _payload()
    official = _official(raw)
    assert lo.apply_overlay(official, lo.build_overlay(raw).per_team()) is official
    assert lo.apply_overlay(official, {}) is official


def test_apply_adds_counting_stats_and_rebuilds_ratios_from_sources():
    raw = _payload(entries_by_team={1: [_entry(11, 0, _line(GAME_A, 24, LINE_10PTS))]})
    official = _official(raw)
    live = lo.apply_overlay(official, lo.build_overlay(raw).per_team())

    assert live is not official
    row = live.set_index("team_id").loc[1]
    assert row["PTS"] == 1010 and row["GP"] == 91 and row["REB"] == 405
    assert row["FG%"] == pytest.approx(404 / 909)
    assert row["FT%"] == pytest.approx(152 / 202)
    # The official frame is never touched.
    assert official.set_index("team_id").loc[1, "PTS"] == 1000


def test_apply_leaves_teams_without_games_byte_identical():
    raw = _payload(entries_by_team={1: [_entry(11, 0, _line(GAME_A, 24, LINE_10PTS))]})
    official = _official(raw)
    live = lo.apply_overlay(official, lo.build_overlay(raw).per_team())
    pd.testing.assert_series_equal(
        live.set_index("team_id").loc[2], official.set_index("team_id").loc[2]
    )


def test_apply_keeps_integer_columns_integer():
    raw = _payload(entries_by_team={1: [_entry(11, 0, _line(GAME_A, 24, LINE_10PTS))]})
    official = _official(raw)
    live = lo.apply_overlay(official, lo.build_overlay(raw).per_team())
    assert live["PTS"].dtype == official["PTS"].dtype
    assert live["GP"].dtype == official["GP"].dtype


def test_apply_ignores_stats_the_frame_does_not_carry():
    raw = _payload(entries_by_team={1: [_entry(11, 0, _line(GAME_A, 24, {**LINE_10PTS, "11": 3.0}))]})
    official = _official(raw)
    live = lo.apply_overlay(official, lo.build_overlay(raw).per_team())
    assert "TO" not in live.columns


# --- schedule, guards --------------------------------------------------------

@pytest.fixture(scope="module")
def schedule():
    return lo.games_by_period(json.loads((FIXTURES / "pro_team_schedules_2027_periods_22_25.json").read_text()))


def test_games_by_period_dedupes_home_and_away(schedule):
    assert set(schedule[24]) == {"401909976", "401909977", "401909978", "401909979"}
    assert schedule[24]["401909976"] == 1794528000000  # 2026-11-13T00:00Z


# ESPN's real run for period 23 landed 2026-11-12T08:15:58Z.
UPDATED_AFTER_23 = 1794471358283


def test_g1_ok_when_standings_cover_yesterday_and_not_today(schedule):
    result = lo.check_g1(UPDATED_AFTER_23, 24, schedule)
    assert result.ok, result.reason


def test_g1_fails_when_standings_moved_but_period_did_not(schedule):
    # Standings updated after period 24's first tip while ESPN still says 24.
    result = lo.check_g1(1794528000000 + 9 * HOUR_MS, 24, schedule)
    assert not result.ok
    assert "did not roll" in result.reason


def test_g1_fails_when_period_rolled_but_standings_did_not(schedule):
    # ESPN already reports 25, standings still from the morning of the 12th.
    result = lo.check_g1(UPDATED_AFTER_23, 25, schedule)
    assert not result.ok
    assert "not updated" in result.reason


def test_g1_fails_without_standings_date(schedule):
    assert not lo.check_g1(None, 24, schedule).ok


def test_g1_fails_without_schedule():
    assert not lo.check_g1(UPDATED_AFTER_23, 24, {}).ok


def test_g1_ok_on_a_period_without_games(schedule):
    # Nothing to apply on an off day, so nothing to guard.
    assert lo.check_g1(UPDATED_AFTER_23, 30, schedule).ok


def test_snapshot_safe_only_once_standings_follow_the_completed_period(schedule):
    assert lo.snapshot_is_safe(UPDATED_AFTER_23, 23, schedule).ok
    assert not lo.snapshot_is_safe(UPDATED_AFTER_23, 24, schedule).ok
    after_24 = 1794528000000 + 8 * HOUR_MS
    assert lo.snapshot_is_safe(after_24, 24, schedule).ok


def test_snapshot_guard_does_not_block_when_it_cannot_tell(schedule):
    # Missing inputs keep today's behaviour (write) rather than stop the DB sync.
    assert lo.snapshot_is_safe(None, 24, schedule).ok
    assert lo.snapshot_is_safe(UPDATED_AFTER_23, 24, {}).ok


def test_games_due_for_a_final_check(schedule):
    games = schedule[24]
    tip = games["401909976"]
    # Nothing is asked before 1 h 45 min past tip.
    assert lo.games_due_for_final_check(games, set(), tip + 104 * 60 * 1000) == []
    due = lo.games_due_for_final_check(games, set(), tip + 105 * 60 * 1000)
    assert set(due) == {"401909976", "401909977"}
    # A game already seen final is never asked about again.
    assert lo.games_due_for_final_check(games, {"401909976"}, tip + 105 * 60 * 1000) == ["401909977"]
    # After the last final there is nothing left to ask.
    assert lo.games_due_for_final_check(games, set(games), tip + 10 * HOUR_MS) == []


# --- reconciliation (G2) ----------------------------------------------------

def test_reconcile_is_clean_when_official_absorbs_exactly_the_overlay():
    raw = _payload(entries_by_team={1: [_entry(11, 0, _line(GAME_A, 24, LINE_10PTS))]})
    old = _official(raw)
    overlay = lo.build_overlay(raw)
    new = lo.apply_overlay(old, overlay.per_team())
    assert lo.reconcile(old, new, overlay) == []


def test_reconcile_reports_each_team_and_stat_that_differs():
    raw = _payload(entries_by_team={1: [_entry(11, 0, _line(GAME_A, 24, LINE_10PTS))]})
    old = _official(raw)
    overlay = lo.build_overlay(raw)
    new = lo.apply_overlay(old, overlay.per_team())
    new.loc[new["team_id"] == 1, "PTS"] += 2   # an ESPN stat correction
    new.loc[new["team_id"] == 2, "REB"] += 1   # a line we never saw
    diffs = lo.reconcile(old, new, overlay)
    assert {(d["team_id"], d["stat"], d["official"], d["overlay"]) for d in diffs} == {
        (1, "PTS", 12, 10), (2, "REB", 1, 0),
    }


# --- the real league ---------------------------------------------------------

@pytest.fixture(scope="module")
def real_period_24():
    return json.loads((FIXTURES / "live_league_period24_final_2027_trimmed.json").read_text())


def test_real_payload_overlay_covers_tonights_four_games(real_period_24):
    overlay = lo.build_overlay(real_period_24)
    assert overlay.period == 24
    assert overlay.game_ids == {"401909976", "401909977", "401909978", "401909979"}
    assert len(overlay.per_team()) == 12
    # Every active-slot line with a game counts exactly one GP.
    gp = sum(t["GP"] for t in overlay.per_team().values())
    assert gp == sum(sum(slots.values()) for slots in overlay.slot_gp.values())
    assert gp == 33


@pytest.fixture(scope="module")
def real_period_25():
    """The same league right after ESPN's run of 2026-11-13 (08:00 UTC): period
    25, valuesByStat now including period 24."""
    return json.loads((FIXTURES / "live_league_period25_after_run_2027_trimmed.json").read_text())


def test_real_hand_over_reconciles_exactly(real_period_24, real_period_25):
    transformer = DataTransformer()
    categories = transformer.resolve_ranking_categories(real_period_24)
    before = transformer.raw_standings_to_totals_df(real_period_24, categories)
    after = transformer.raw_standings_to_totals_df(real_period_25, categories)
    overlay = lo.build_overlay(real_period_24)

    # G2: ESPN's official move equals last night's overlay, every team and stat.
    assert lo.reconcile(before, after, overlay) == []

    # Live at 07:00 was already this morning's official standings.
    live = lo.apply_overlay(before, overlay.per_team()).set_index("team_id")
    official = after.set_index("team_id")
    for col in [c for c in official.columns if c != "team_name"]:
        # ESPN rounds FG%/FT% to 8 decimals; everything else is exact.
        assert live[col].to_numpy() == pytest.approx(official[col].to_numpy(), abs=1e-7), col

    # After the run: the new period has nothing yet (no double count), G1
    # passes, and day 24 may be written to the DB.
    assert real_period_25["scoringPeriodId"] == 25
    assert lo.build_overlay(real_period_25).is_empty
    updated = real_period_25["status"]["standingsUpdateDate"]
    schedule = lo.games_by_period(json.loads((FIXTURES / "pro_team_schedules_2027_periods_22_25.json").read_text()))
    assert lo.check_g1(updated, 25, schedule).ok
    assert lo.snapshot_is_safe(updated, 24, schedule).ok
    # Before the run, the same guard held day 24 back.
    assert not lo.snapshot_is_safe(real_period_24["status"]["standingsUpdateDate"], 24, schedule).ok

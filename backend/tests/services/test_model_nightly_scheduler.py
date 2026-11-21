"""The nightly scheduler, driven on a fake clock: when each attempt fires for
a night, given its tip-offs, its games' progress, restarts and failures."""

from datetime import date, datetime, timedelta, timezone

import pytest

from app.services import model_nightly_scheduler as sched

ET = sched.EASTERN
NIGHT = date(2026, 11, 19)


def et(day: date, hh: int, mm: int = 0, ss: int = 0) -> datetime:
    return datetime(day.year, day.month, day.day, hh, mm, ss, tzinfo=ET)


NEXT = NIGHT + timedelta(days=1)


# --- pure helpers --------------------------------------------------------------

class TestNightFor:
    def test_before_the_deadline_it_is_still_the_previous_night(self):
        assert sched.night_for(et(NEXT, 3, 59)) == NIGHT
        assert sched.night_for(et(NEXT, 0, 30)) == NIGHT

    def test_from_the_deadline_on_it_is_the_current_date(self):
        assert sched.night_for(et(NEXT, 4, 0)) == NEXT
        assert sched.night_for(et(NIGHT, 23, 59)) == NIGHT
        assert sched.night_for(et(NIGHT, 12, 0)) == NIGHT

    def test_any_timezone_in_is_read_as_new_york(self):
        # 10:30 Israel on Nov 20 is 03:30 ET: still the night of Nov 19.
        israel = datetime(2026, 11, 20, 10, 30, tzinfo=sched.ZoneInfo("Asia/Jerusalem"))
        assert sched.night_for(israel) == NIGHT


class TestPlanNight:
    def test_first_check_is_the_last_tip_plus_the_buffer(self):
        tip = et(NIGHT, 22, 30)
        plan = sched.plan_night(NIGHT, tip, True)
        assert plan.first_check == et(NEXT, 0, 45)
        assert plan.deadline == et(NEXT, 4, 0)
        assert plan.source == "tip"

    def test_an_afternoon_only_slate_is_checked_the_same_afternoon(self):
        plan = sched.plan_night(NIGHT, et(NIGHT, 14, 0), True)
        assert plan.first_check == et(NIGHT, 16, 15)

    def test_a_night_without_games_is_sealed_after_midnight(self):
        plan = sched.plan_night(NIGHT, None, True)
        assert (plan.first_check, plan.source) == (et(NEXT, 0, 15), "no_games")

    def test_an_unreadable_scoreboard_falls_back_to_a_fixed_first_check(self):
        plan = sched.plan_night(NIGHT, None, False)
        assert (plan.first_check, plan.source) == (et(NEXT, 1, 30), "fallback")

    def test_the_first_check_never_passes_the_deadline(self):
        plan = sched.plan_night(NIGHT, et(NEXT, 2, 0), True)     # absurdly late tip
        assert plan.first_check == plan.deadline

    @pytest.mark.parametrize("night, utc_hour", [
        (date(2026, 10, 30), 8),     # deadline Oct 31 04:00, EDT
        (date(2026, 10, 31), 9),     # deadline Nov 1 04:00: clocks went back at 02:00, EST
        (date(2026, 11, 1), 9),      # deadline Nov 2, EST
        (date(2027, 3, 13), 8),      # deadline Mar 14 04:00, already EDT
        (date(2027, 3, 12), 9),      # deadline Mar 13, EST
    ])
    def test_deadline_follows_new_york_clock_changes(self, night, utc_hour):
        deadline = sched.plan_night(night, None, True).deadline
        assert deadline.astimezone(timezone.utc).hour == utc_hour
        assert deadline.astimezone(ET).hour == 4


class TestNextAttempt:
    plan = sched.plan_night(NIGHT, et(NIGHT, 22, 30), True)      # first 00:45, deadline 04:00

    def test_first_attempt_is_the_first_check(self):
        assert sched.next_attempt(self.plan, False, None) == et(NEXT, 0, 45)

    def test_retries_every_fifteen_minutes(self):
        assert sched.next_attempt(self.plan, False, et(NEXT, 1, 15, 40)) == et(NEXT, 1, 30, 40)

    def test_retries_never_pass_the_deadline(self):
        assert sched.next_attempt(self.plan, False, et(NEXT, 3, 50)) == et(NEXT, 4, 0)

    def test_a_retry_never_comes_before_a_first_check_that_moved_later(self):
        assert sched.next_attempt(self.plan, False, et(NEXT, 0, 0)) == et(NEXT, 0, 45)

    def test_once_done_only_the_deadline_is_left(self):
        assert sched.next_attempt(self.plan, True, et(NEXT, 1, 15)) == et(NEXT, 4, 0)


# --- the loop on a fake clock --------------------------------------------------

class _Stop(Exception):
    pass


class FakeService:
    """run_catchup returns, for the scheduler's night, whatever ``outcome``
    says at that moment (a status string, or an exception to raise)."""

    def __init__(self, clock, outcome):
        self.clock, self.outcome, self.calls = clock, outcome, []

    async def run_catchup(self, through=None, final=False):
        self.calls.append((self.clock.now.astimezone(ET), through, final))
        result = self.outcome(self.clock.now, through, final)
        if isinstance(result, Exception):
            raise result
        return {through.isoformat(): result}


class Clock:
    def __init__(self, start: datetime, until: datetime):
        self.now, self.until, self.sleeps = start, until, []

    async def sleep(self, seconds):
        assert seconds > 0, "the loop must never spin"
        assert seconds <= sched.MAX_SLEEP.total_seconds() + 1e-6
        self.sleeps.append(seconds)
        self.now = self.now + timedelta(seconds=seconds)
        if self.now >= self.until:
            raise _Stop


def run_loop(monkeypatch, start, until, outcome, tips, over=None):
    """``tips(night, now)`` -> (last tip, scoreboard ok) as the scoreboard
    would say at that moment; ``over(night, now)`` -> whether its games are all
    final (default: yes, so the attempt runs)."""
    clock = Clock(start, until)
    service = FakeService(clock, outcome)
    monkeypatch.setattr(sched, "_now", lambda: clock.now)
    monkeypatch.setattr(sched.asyncio, "sleep", clock.sleep)
    monkeypatch.setattr(sched, "_read_last_tip", lambda night: tips(night, clock.now))
    monkeypatch.setattr(sched, "_read_games_over",
                        lambda night: True if over is None else over(night, clock.now))
    monkeypatch.setattr(sched, "ModelNightlyService", lambda: service)
    monkeypatch.setattr(sched, "start_job_run", lambda name: "run")
    with pytest.raises(_Stop):
        import asyncio
        asyncio.run(sched.start_scheduler())
    return [(at.replace(microsecond=0), night, final) for at, night, final in service.calls]


def tip_at(hh, mm=0):
    """Every night's last tip-off at the given ET time on that night."""
    return lambda night, now: (et(night, hh, mm), True)


def done_from(when):
    return lambda now, night, final: "processed" if now >= when else "incomplete_data"


START = et(NIGHT, 12, 0)


def test_normal_night_one_attempt_then_the_deadline(monkeypatch):
    calls = run_loop(monkeypatch, START, et(NEXT, 12), done_from(et(NEXT, 0, 45)), tip_at(22, 30))
    assert calls == [(et(NEXT, 0, 45), NIGHT, False), (et(NEXT, 4, 0), NIGHT, True)]


def test_overtime_retries_every_fifteen_minutes_until_done(monkeypatch):
    calls = run_loop(monkeypatch, START, et(NEXT, 12), done_from(et(NEXT, 1, 10)), tip_at(22, 30))
    assert [c[0] for c in calls] == [et(NEXT, 0, 45), et(NEXT, 1, 0), et(NEXT, 1, 15), et(NEXT, 4, 0)]
    assert [c[2] for c in calls] == [False, False, False, True]


def test_a_night_that_never_completes_retries_to_the_deadline_then_moves_on(monkeypatch):
    never = lambda now, night, final: "incomplete_data"
    calls = run_loop(monkeypatch, START, et(NEXT, 23, 0), never, tip_at(22, 30))
    times = [c[0] for c in calls if c[1] == NIGHT]
    assert times[0] == et(NEXT, 0, 45) and times[-1] == et(NEXT, 4, 0)
    assert all(b - a == timedelta(minutes=15) for a, b in zip(times[:-2], times[1:-1]))
    assert len(times) == 14                                  # 00:45 .. 03:45 every 15 min (13) + 04:00
    assert calls[-1][1] == NIGHT and calls[-1][2] is True
    # The next night is planned from its own tip-off, not retried in a loop.
    assert not [c for c in calls if c[1] == NEXT]


def test_the_next_night_follows(monkeypatch):
    calls = run_loop(monkeypatch, START, et(NEXT + timedelta(days=1), 12),
                     lambda now, night, final: "processed", tip_at(22, 0))
    assert calls == [
        (et(NEXT, 0, 15), NIGHT, False), (et(NEXT, 4, 0), NIGHT, True),
        (et(NEXT + timedelta(days=1), 0, 15), NEXT, False), (et(NEXT + timedelta(days=1), 4, 0), NEXT, True),
    ]


def test_no_games_night_is_sealed_after_midnight(monkeypatch):
    no_games = lambda night, now: (None, True)
    calls = run_loop(monkeypatch, START, et(NEXT, 12), lambda now, night, final: "no_games", no_games)
    assert calls == [(et(NEXT, 0, 15), NIGHT, False), (et(NEXT, 4, 0), NIGHT, True)]


def test_scoreboard_down_falls_back_to_the_fixed_first_check(monkeypatch):
    down = lambda night, now: (None, False)
    calls = run_loop(monkeypatch, START, et(NEXT, 12), done_from(et(NEXT, 1, 30)), down)
    assert calls == [(et(NEXT, 1, 30), NIGHT, False), (et(NEXT, 4, 0), NIGHT, True)]


def test_afternoon_only_slate_runs_that_afternoon_for_its_own_us_date(monkeypatch):
    """A single 14:00 ET game (e.g. in Europe): the attempt at 16:15 ET is
    23:15 the same day in Israel, so the night must be passed explicitly."""
    calls = run_loop(monkeypatch, et(NIGHT, 9), et(NEXT, 12), done_from(et(NIGHT, 16, 15)), tip_at(14, 0))
    assert calls[0] == (et(NIGHT, 16, 15), NIGHT, False)
    assert calls[1] == (et(NEXT, 4, 0), NIGHT, True)


def test_a_tip_off_moved_later_pushes_the_attempt_later(monkeypatch):
    # Planned at noon with a 22:00 tip; from 18:00 the scoreboard says 23:00.
    def tips(night, now):
        return (et(night, 23 if now >= et(NIGHT, 18) else 22), True)
    calls = run_loop(monkeypatch, START, et(NEXT, 12), done_from(et(NEXT, 1, 15)), tips)
    assert calls[0][0] == et(NEXT, 1, 15)


def test_long_waits_are_cut_so_the_plan_is_read_again(monkeypatch):
    reads = []

    def tips(night, now):
        reads.append(now)
        return et(night, 22, 30), True
    run_loop(monkeypatch, et(NIGHT, 4, 1), et(NEXT, 2), done_from(et(NEXT, 1, 15)), tips)
    gaps = [b - a for a, b in zip(reads, reads[1:])]
    assert max(gaps) <= sched.MAX_SLEEP + timedelta(minutes=16)


def test_restart_after_the_first_check_runs_after_the_startup_delay(monkeypatch):
    """A deploy at 02:00 ET: the night is already in the ledger; one attempt
    a few minutes after startup sees that, then only the deadline is left."""
    already = lambda now, night, final: "already_processed"
    calls = run_loop(monkeypatch, et(NEXT, 2, 0), et(NEXT, 12), already, tip_at(22, 30))
    assert calls == [(et(NEXT, 2, 3), NIGHT, False), (et(NEXT, 4, 0), NIGHT, True)]


def test_restart_right_before_the_deadline_still_runs_the_final_attempt(monkeypatch):
    calls = run_loop(monkeypatch, et(NEXT, 3, 59), et(NEXT, 12),
                     lambda now, night, final: "already_processed", tip_at(22, 30))
    assert calls == [(et(NEXT, 4, 2), NIGHT, True)]


def test_restart_during_the_day_waits_for_tonight(monkeypatch):
    calls = run_loop(monkeypatch, et(NEXT, 9, 0), et(NEXT + timedelta(days=1), 2),
                     lambda now, night, final: "processed", tip_at(22, 0))
    assert calls[0] == (et(NEXT + timedelta(days=1), 0, 15), NEXT, False)


def test_a_failed_attempt_is_retried_and_a_failed_deadline_still_moves_on(monkeypatch):
    def outcome(now, night, final):
        if night == NIGHT and now < et(NEXT, 1, 0):
            return RuntimeError("db down")
        if night == NIGHT and final:
            return RuntimeError("db down again")
        return "processed"
    calls = run_loop(monkeypatch, START, et(NEXT + timedelta(days=1), 2), outcome, tip_at(22, 30))
    assert [c[0] for c in calls if c[1] == NIGHT] == [et(NEXT, 0, 45), et(NEXT, 1, 0), et(NEXT, 4, 0)]
    assert calls[-1][1] == NEXT            # the failing deadline did not stop the scheduler


def test_next_trigger_is_reported_for_health(monkeypatch):
    sched._next_trigger = None
    run_loop(monkeypatch, START, et(NIGHT, 13), done_from(et(NEXT, 0, 45)), tip_at(22, 30))
    assert sched.next_trigger() == et(NEXT, 0, 45)


def test_read_last_tip_reports_an_unreadable_scoreboard(monkeypatch):
    def boom(dates):
        raise RuntimeError("espn down")
    monkeypatch.setattr(sched.espn_client, "scoreboard", boom)
    assert sched._read_last_tip(NIGHT) == (None, False)
    monkeypatch.setattr(sched.espn_client, "scoreboard", lambda dates: {"events": []})
    assert sched._read_last_tip(NIGHT) == (None, True)


def test_read_last_tip_survives_a_malformed_event(monkeypatch):
    """Parsing is guarded like the fetch: a bad event must not end the loop."""
    monkeypatch.setattr(sched.espn_client, "scoreboard", lambda dates: {"events": [{"id": "1", "season": {"type": 2}}]})   # no competitions
    assert sched._read_last_tip(NIGHT) == (None, False)


def test_retries_skip_the_catchup_while_games_are_on(monkeypatch):
    """Games run long: the 00:45 and 01:00 checks see a game still on and skip
    the catch-up (and its DB reads); the first check after the final buzzer runs."""
    over = lambda night, now: now >= et(NEXT, 1, 10)
    calls = run_loop(monkeypatch, START, et(NEXT, 12), done_from(et(NEXT, 1, 10)),
                     tip_at(22, 30), over=over)
    assert calls == [(et(NEXT, 1, 15), NIGHT, False), (et(NEXT, 4, 0), NIGHT, True)]


def test_an_unreadable_scoreboard_does_not_skip_the_attempt(monkeypatch):
    calls = run_loop(monkeypatch, START, et(NEXT, 12), done_from(et(NEXT, 0, 45)),
                     tip_at(22, 30), over=lambda night, now: None)
    assert calls[0] == (et(NEXT, 0, 45), NIGHT, False)


def test_the_deadline_attempt_runs_even_with_games_on(monkeypatch):
    never = lambda now, night, final: "incomplete_data"
    calls = run_loop(monkeypatch, START, et(NEXT, 12), never, tip_at(22, 30),
                     over=lambda night, now: False)
    assert calls == [(et(NEXT, 4, 0), NIGHT, True)]


def test_read_games_over(monkeypatch):
    def event(completed):
        return {"date": "2026-11-20T00:30Z", "season": {"type": 2},
                "status": {"type": {"completed": completed, "name": "STATUS_FINAL" if completed else "STATUS_IN_PROGRESS"}},
                "competitions": [{"competitors": [{"team": {"id": "1"}}, {"team": {"id": "2"}}]}]}
    monkeypatch.setattr(sched.espn_client, "scoreboard", lambda dates: {"events": [event(True), event(False)]})
    assert sched._read_games_over(NIGHT) is False
    monkeypatch.setattr(sched.espn_client, "scoreboard", lambda dates: {"events": [event(True)]})
    assert sched._read_games_over(NIGHT) is True

    def boom(dates):
        raise RuntimeError("espn down")
    monkeypatch.setattr(sched.espn_client, "scoreboard", boom)
    assert sched._read_games_over(NIGHT) is None

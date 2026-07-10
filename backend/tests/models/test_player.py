import pytest
from datetime import date

from app.models import StatTimePeriod


SEASON_START = date(2025, 10, 22)
TODAY = date(2026, 7, 10)


def test_resolve_window_season():
    start, end = StatTimePeriod.resolve_window(
        StatTimePeriod.SEASON, None, None, SEASON_START, today=TODAY
    )
    assert start == SEASON_START
    assert end == TODAY


def test_resolve_window_last_7():
    start, end = StatTimePeriod.resolve_window(
        StatTimePeriod.LAST_7, None, None, SEASON_START, today=TODAY
    )
    assert (end - start).days == 6
    assert end == TODAY


def test_resolve_window_last_15():
    start, end = StatTimePeriod.resolve_window(
        StatTimePeriod.LAST_15, None, None, SEASON_START, today=TODAY
    )
    assert (end - start).days == 14
    assert end == TODAY


def test_resolve_window_last_30():
    start, end = StatTimePeriod.resolve_window(
        StatTimePeriod.LAST_30, None, None, SEASON_START, today=TODAY
    )
    assert (end - start).days == 29
    assert end == TODAY


def test_resolve_window_last_30_clamps_to_season_start_early_in_season():
    early_today = date(2025, 10, 25)  # 3 days into the season
    start, end = StatTimePeriod.resolve_window(
        StatTimePeriod.LAST_30, None, None, SEASON_START, today=early_today
    )
    assert start == SEASON_START
    assert end == early_today


def test_resolve_window_custom_uses_given_dates():
    custom_start, custom_end = date(2026, 1, 1), date(2026, 1, 10)
    start, end = StatTimePeriod.resolve_window(
        StatTimePeriod.CUSTOM, custom_start, custom_end, SEASON_START, today=TODAY
    )
    assert start == custom_start
    assert end == custom_end


def test_resolve_window_custom_missing_dates_raises():
    with pytest.raises(ValueError, match="requires both start and end"):
        StatTimePeriod.resolve_window(StatTimePeriod.CUSTOM, None, None, SEASON_START, today=TODAY)

    with pytest.raises(ValueError, match="requires both start and end"):
        StatTimePeriod.resolve_window(
            StatTimePeriod.CUSTOM, date(2026, 1, 1), None, SEASON_START, today=TODAY
        )


@pytest.mark.parametrize("period,expected_id", [
    (StatTimePeriod.SEASON, 0),
    (StatTimePeriod.LAST_7, 1),
    (StatTimePeriod.LAST_15, 2),
    (StatTimePeriod.LAST_30, 3),
    (StatTimePeriod.CUSTOM, 0),
])
def test_to_stat_split_id(period, expected_id):
    assert StatTimePeriod.to_stat_split_id(period) == expected_id

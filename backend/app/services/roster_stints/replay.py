"""Turn one player's feed rows and box-score appearances into roster stints.

Pure functions, no I/O. A stint is a date range on one team, inclusive at both
ends; an open end means he is still there.

Feed rules (feed_intervals):
  - Signing / Trade ("received") / AwardOnWaivers: he joins that team that day,
    and leaves any team he was on the day before.
  - Waive: he leaves the day before (a waived player is gone for that day's
    game). A waive or conversion by a team he isn't on means the feed missed
    his signing there, so he leaves his current team either way.
  - A 10-day contract ends after 10 days unless a newer row comes first.
  - ContractConverted, or a same-team signing that changes the contract type:
    same team, new stint with the new two-way flag.
  - A same-team re-signing or extension changes nothing.

Expiry (confirm_carryover): contracts end in the offseason with no row, so a
stint from before July 1 needs confirmation to carry into this season.

Box rules (merge_box): an appearance for team T on day D (played or a listed
DNP) means he was on T that day. Stints for T are stretched to cover it, a
missing one is created, and other teams' stints that overlap are trimmed.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import date, timedelta

from app.services.roster_stints.feed import CLAIMED, CONVERTED, SIGNING, TRADE, WAIVE, FeedRow
from model_stats_inference.espn.teams import TEAM_ID_TO_NAME

ONE_DAY = timedelta(days=1)
TEN_DAYS = timedelta(days=9)  # inclusive: signed on day 1, last day is day 10
# A box appearance this close before the feed's join date is the feed being
# late, not a separate stint.
FEED_LAG = timedelta(days=14)


@dataclass(frozen=True)
class Stint:
    team_id: int
    start: date
    end: date | None          # None = still on the team
    two_way: bool = False
    source: str = "feed"      # 'feed' | 'feed+box' | 'box' | 'box_only'

    def covers(self, d: date) -> bool:
        return self.start <= d and (self.end is None or d <= self.end)


def _is_two_way(description: str) -> bool:
    return "two-way" in description.lower()


def _is_ten_day(description: str) -> bool:
    return "10-day" in description.lower()


def feed_intervals(rows: list[FeedRow], today: date) -> list[Stint]:
    """Every stint the feed implies for one player, over his whole history."""
    out: list[Stint] = []
    cur: Stint | None = None
    ten_day_end: date | None = None

    def close(on: date) -> None:
        nonlocal cur, ten_day_end
        if cur is not None and on >= cur.start:
            out.append(replace(cur, end=on))
        cur, ten_day_end = None, None

    for row in sorted(rows, key=lambda r: (r.day, r.order)):
        if cur is not None and ten_day_end is not None and row.day > ten_day_end:
            renewed = row.kind == SIGNING and row.team_id == cur.team_id and row.day <= ten_day_end + ONE_DAY
            if not renewed:
                close(ten_day_end)
        if row.kind == WAIVE:
            # A waive by a team he isn't on means the feed missed his signing
            # there; either way he is off his current team by now.
            close(row.day - ONE_DAY)
            continue
        if row.kind == CONVERTED:
            two_way = _is_two_way(row.description)
            if cur is not None and cur.team_id == row.team_id:
                if two_way != cur.two_way:
                    close(row.day - ONE_DAY)
                    cur = Stint(row.team_id, row.day, None, two_way)
            else:
                # Converted by another team: the feed missed his signing there.
                close(row.day - ONE_DAY)
                cur = Stint(row.team_id, row.day, None, two_way)
            continue
        if row.kind not in (SIGNING, TRADE, CLAIMED):
            continue
        if row.kind == TRADE and "received" not in row.description.lower():
            continue
        if row.kind == SIGNING:
            two_way = _is_two_way(row.description)
            ten = row.day + TEN_DAYS if _is_ten_day(row.description) else None
            if cur is not None and cur.team_id == row.team_id:
                if two_way != cur.two_way:
                    close(row.day - ONE_DAY)
                    cur = Stint(row.team_id, row.day, None, two_way)
                ten_day_end = ten
                continue
            close(row.day - ONE_DAY)
            cur, ten_day_end = Stint(row.team_id, row.day, None, two_way), ten
            continue
        # Trade or waiver claim: the contract (and its two-way flag) moves with him.
        if cur is not None and cur.team_id == row.team_id:
            continue
        two_way = cur.two_way if cur is not None else False
        close(row.day - ONE_DAY)
        cur = Stint(row.team_id, row.day, None, two_way)

    if cur is not None:
        if ten_day_end is not None and ten_day_end < today:
            close(ten_day_end)
        else:
            out.append(cur)
    return out


def _runs(appearances: list[tuple[date, int]]) -> list[tuple[int, date, date]]:
    """Consecutive appearances for the same team -> (team, first day, last day)."""
    runs: list[tuple[int, date, date]] = []
    for d, team in sorted(appearances):
        if runs and runs[-1][0] == team:
            runs[-1] = (team, runs[-1][1], d)
        else:
            runs.append((team, d, d))
    return runs


def _overlaps(s: Stint, first: date, last: date) -> bool:
    return s.start <= last and (s.end is None or s.end >= first)


def merge_box(
    stints: list[Stint], appearances: list[tuple[date, int]], *, has_feed: bool,
) -> list[Stint]:
    """Make the stints agree with the box scores. Box scores win."""
    out = sorted(stints, key=lambda s: s.start)
    runs = _runs(appearances)
    for i, (team, first, last) in enumerate(runs):
        mine = [s for s in out if s.team_id == team and _overlaps(s, first, last + FEED_LAG)]
        if mine:
            s = mine[0]
            new = replace(
                s,
                start=min(s.start, first),
                end=None if s.end is None else max(s.end, last),
            )
            if new != s:
                new = replace(new, source="feed+box" if s.source == "feed" else s.source)
            out[out.index(s)] = new
            covering = new
        else:
            later = any(r[1] > last for r in runs[i + 1:]) or any(
                s.start > last for s in out if s.team_id != team
            )
            covering = Stint(team, first, last if later else None, False, "box" if has_feed else "box_only")
            out.append(covering)
        # Another team can't hold him on a day he appeared for this one.
        later_teams = {r[0] for r in runs[i + 1:]}
        trimmed: list[Stint] = []
        for s in out:
            if s is covering or s.team_id == team or not _overlaps(s, first, last):
                trimmed.append(s)
                continue
            if s.start < first:
                trimmed.append(replace(s, end=first - ONE_DAY))
                if (s.end is None or s.end > last) and s.team_id in later_teams:
                    # He played for s's team again after this run, so the
                    # feed's stint resumes the day after it.
                    trimmed.append(replace(s, start=last + ONE_DAY))
            elif s.end is None or s.end > last:
                trimmed.append(replace(s, start=last + ONE_DAY))
        out = sorted(trimmed, key=lambda s: s.start)
    return out


def clip_to_season(stints: list[Stint], season_start: date, today: date) -> list[Stint]:
    out = []
    for s in stints:
        if s.end is not None and s.end < season_start:
            continue
        if s.start > today:
            continue
        out.append(replace(s, start=max(s.start, season_start)))
    return out


def offseason_start(season_start: date) -> date:
    """July 1 before the season: when last season's contracts can expire."""
    return date(season_start.year if season_start.month >= 7 else season_start.year - 1, 7, 1)


def confirm_carryover(
    stints: list[Stint],
    feed_rows: list[FeedRow],
    appearances: list[tuple[date, int]],
    current_team: int | None,
    season_start: date,
) -> list[Stint]:
    """Contracts end without a feed row (a rest-of-season deal, a two-way, any
    expiring contract), so a stint that began before this offseason only
    carries into the season when something confirms he is still there: he
    appeared for that team this season, he is on its roster today, or the feed
    has a row since July 1 for that team (a re-signing, a waive, a trade away).
    Otherwise it ends June 30."""
    july1 = offseason_start(season_start)
    out = []
    for s in stints:
        if s.start >= july1 or (s.end is not None and s.end < july1):
            out.append(s)
            continue
        name = TEAM_ID_TO_NAME.get(s.team_id, "\0").lower()
        confirmed = (
            s.team_id == current_team
            or any(team == s.team_id and d >= season_start for d, team in appearances)
            or any(
                r.day >= july1 and (r.team_id == s.team_id or f"from {name}" in r.description.lower())
                for r in feed_rows
            )
        )
        out.append(s if confirmed else replace(s, end=july1 - ONE_DAY))
    return out


def build_stints(
    feed_rows: list[FeedRow],
    appearances: list[tuple[date, int]],
    season_start: date,
    today: date,
    current_team: int | None = None,
) -> list[Stint]:
    """One player's stints for this season. With no feed rows the stints come
    from box scores alone ('box_only', approximate start/end). `current_team`
    is his team on ESPN's rosters today, if any."""
    intervals = feed_intervals(feed_rows, today) if feed_rows else []
    intervals = confirm_carryover(intervals, feed_rows, appearances, current_team, season_start)
    season = clip_to_season(intervals, season_start, today)
    merged = merge_box(season, appearances, has_feed=bool(feed_rows))
    return clip_to_season(merged, season_start, today)

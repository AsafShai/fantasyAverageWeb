"""The live overlay: tonight's stat lines, summed per fantasy team, on top of
ESPN's official season totals.

Everything here is pure: it reads payloads the app already holds and returns
new values. Nothing is stored, and the official frame is never modified (see
plans/live_data_updates_design.md, section 3).

Data source: the league standings payload DataProvider already polls every
30 s carries every team's lineup for ESPN's current scoring period in
``schedule[0].teams[].rosterForCurrentScoringPeriod.entries[]``, each player
with tonight's single-day line (statSplitTypeId 5, statSourceId 0, the current
scoringPeriodId, externalId = the ESPN game id). ESPN's season totals are
exactly the sum of those lines over the active slots, so adding tonight's
lines to ``valuesByStat`` gives the totals ESPN will publish tomorrow morning.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from types import MappingProxyType
from typing import Collection, Mapping, Optional

import pandas as pd

from app.utils.constants import ESPN_COLUMN_MAP, LINEUP_SLOT_MAP, RATIO_CATEGORIES, DERIVED_CATEGORIES
from app.utils.espn_stat_map import UNSUPPORTED_CATEGORIES

# Bench and IR never count toward a team's totals.
INACTIVE_SLOT_IDS = frozenset({12, 13})
SINGLE_DAY_SPLIT = 5
ACTUAL_STATS_SOURCE = 0
# A game is not asked about before this long after its tip: NBA games take
# about 2 h 15 min, so this costs no delay (plan section 2, rule 3).
FINAL_CHECK_AFTER_TIP_MS = 105 * 60 * 1000

_ID_COLUMNS = ('team_id', 'team_name')


def _summable(category: str) -> bool:
    """A quotient (FG%, PPG...) or an unsupported formula cannot be summed
    across lines; it is rebuilt from its summed sources instead."""
    return category not in DERIVED_CATEGORIES and category not in UNSUPPORTED_CATEGORIES


@dataclass(frozen=True)
class LiveOverlay:
    """Tonight's counted lines for ESPN's current period.

    ``team_games`` holds, per fantasy team, the summed counting stats of its
    active-slot players per NBA game id. Keeping the game id lets the same
    overlay produce both flavours (plan 3.4): every started game for totals,
    finished games only for averages.
    """
    period: int
    as_of: datetime
    team_games: Mapping[int, Mapping[str, Mapping[str, float]]]
    slot_gp: Mapping[int, Mapping[str, int]]
    version: str
    game_ids: frozenset = field(default_factory=frozenset)

    @property
    def is_empty(self) -> bool:
        return not self.game_ids

    def per_team(self, games: Optional[Collection[str]] = None) -> dict[int, dict[str, float]]:
        """{team_id: {stat: tonight's sum}}. ``games`` limits it to those game
        ids (the settled flavour); None counts every started game. Teams with
        nothing counted are left out."""
        out: dict[int, dict[str, float]] = {}
        for team_id, by_game in self.team_games.items():
            summed: dict[str, float] = {}
            for game_id, stats in by_game.items():
                if games is not None and game_id not in games:
                    continue
                for stat, value in stats.items():
                    summed[stat] = summed.get(stat, 0) + value
            if summed:
                out[team_id] = summed
        return out


def _blocked_slots(team: dict, period: int) -> set[int]:
    """Slots whose games-played cap was crossed on an earlier period. ESPN
    counts the whole day on which a cap is crossed and nothing after it."""
    blocked: set[int] = set()
    by_slot = (team.get('cumulativeScore') or {}).get('statBySlot') or {}
    for slot_id, state in by_slot.items():
        if not isinstance(state, dict) or not state.get('limitExceeded'):
            continue
        on = state.get('exceededOnScoringPeriod') or 0
        if on < period:
            blocked.add(int(slot_id))
    return blocked


def _tonight_line(player: dict, period: int) -> Optional[dict]:
    for line in player.get('stats') or []:
        if (line.get('statSplitTypeId') == SINGLE_DAY_SPLIT
                and line.get('statSourceId') == ACTUAL_STATS_SOURCE
                and line.get('scoringPeriodId') == period):
            return line
    return None


def build_overlay(raw: dict, as_of: Optional[datetime] = None) -> LiveOverlay:
    """The overlay for the payload's own ``scoringPeriodId``.

    The period always comes from the same payload as the official totals,
    never from the calendar: late games run past midnight Eastern while ESPN
    is still on the same period, and at ESPN's morning run the baseline and
    the period move together (plan 3.3).
    """
    period = int(raw.get('scoringPeriodId') or 0)
    team_games: dict[int, dict[str, dict[str, float]]] = {}
    slot_gp: dict[int, dict[str, int]] = {}
    game_ids: set[str] = set()

    schedule = raw.get('schedule') or []
    teams = (schedule[0].get('teams') if schedule else None) or []
    for team in teams:
        team_id = team.get('teamId')
        if team_id is None:
            continue
        blocked = _blocked_slots(team, period)
        for entry in (team.get('rosterForCurrentScoringPeriod') or {}).get('entries') or []:
            slot = entry.get('lineupSlotId')
            if slot is None or slot in INACTIVE_SLOT_IDS or slot in blocked:
                continue
            player = (entry.get('playerPoolEntry') or {}).get('player') or {}
            line = _tonight_line(player, period)
            if line is None or not line.get('stats'):
                continue
            game_id = str(line.get('externalId') or '')
            stats: dict[str, float] = {}
            for key, value in line['stats'].items():
                category = ESPN_COLUMN_MAP.get(str(key))
                if category is None or not _summable(category) or value is None:
                    continue
                stats[category] = float(value)
            if not stats:
                continue
            by_game = team_games.setdefault(int(team_id), {}).setdefault(game_id, {})
            for category, value in stats.items():
                by_game[category] = by_game.get(category, 0) + value
            game_ids.add(game_id)
            if stats.get('GP'):
                label = LINEUP_SLOT_MAP.get(slot)
                if label:
                    team_slots = slot_gp.setdefault(int(team_id), {})
                    team_slots[label] = team_slots.get(label, 0) + int(stats['GP'])

    digest = hashlib.sha1(
        json.dumps([period, team_games], sort_keys=True, default=str).encode()
    ).hexdigest()[:16]
    return LiveOverlay(
        period=period,
        as_of=as_of or datetime.now(timezone.utc),
        team_games=MappingProxyType({t: MappingProxyType(g) for t, g in team_games.items()}),
        slot_gp=MappingProxyType({t: MappingProxyType(s) for t, s in slot_gp.items()}),
        version=digest,
        game_ids=frozenset(game_ids),
    )


def apply_overlay(official: pd.DataFrame, per_team: Mapping[int, Mapping[str, float]]) -> pd.DataFrame:
    """Official totals plus ``per_team``, as a new frame.

    Returns ``official`` itself when there is nothing to add, so off-hours
    every memo keyed on frame identity is shared with the official view.
    Counting columns are added; ratio columns are rebuilt from their summed
    sources, and only for teams that got something, so a team without games
    tonight keeps ESPN's exact values. Columns the frame does not carry are
    ignored; nothing is added as a new column.
    """
    if official is None or not per_team or 'team_id' not in official.columns:
        return official
    addable = [c for c in official.columns if c not in _ID_COLUMNS and _summable(c)]
    team_ids = official['team_id']
    touched = team_ids.isin([t for t, stats in per_team.items() if any(stats.get(c) for c in addable)])
    if not touched.any():
        return official

    live = official.copy()
    for col in addable:
        add = team_ids.map(lambda t, c=col: (per_team.get(t) or {}).get(c, 0)).fillna(0)
        if not add.any():
            continue
        if pd.api.types.is_integer_dtype(live[col].dtype):
            live[col] = live[col] + add.round().astype(live[col].dtype)
        else:
            live[col] = live[col] + add
    for category, (numerator, denominator) in RATIO_CATEGORIES.items():
        if category not in live.columns or numerator not in live.columns or denominator not in live.columns:
            continue
        den = live.loc[touched, denominator].astype(float)
        live.loc[touched, category] = (live.loc[touched, numerator].astype(float) / den.where(den != 0)).fillna(0.0)
    return live


# --- schedule ------------------------------------------------------------------

def games_by_period(schedule_payload: Optional[dict]) -> dict[int, dict[str, int]]:
    """{scoringPeriodId: {game_id: tip time in epoch ms}} from the cached
    pro-team schedule (``proTeamSchedules_wl``). Every game appears under
    both of its teams; it is listed once."""
    out: dict[int, dict[str, int]] = {}
    for team in ((schedule_payload or {}).get('settings') or {}).get('proTeams') or []:
        for period, games in (team.get('proGamesByScoringPeriod') or {}).items():
            for game in games or []:
                if game.get('id') is None or game.get('date') is None:
                    continue
                out.setdefault(int(period), {})[str(game['id'])] = int(game['date'])
    return out


def _last_tip_before(period: int, schedule: Mapping[int, Mapping[str, int]]) -> Optional[int]:
    earlier = [p for p in schedule if p < period and schedule[p]]
    return max(schedule[max(earlier)].values()) if earlier else None


@dataclass(frozen=True)
class GuardResult:
    ok: bool
    reason: str


def check_g1(standings_updated_ms: Optional[int], period: int,
             schedule: Mapping[int, Mapping[str, int]]) -> GuardResult:
    """Guard G1: apply the overlay for ``period`` only when ESPN's official
    totals cover every earlier period and none of this one, i.e. ESPN's
    standings update landed after the previous game day's last tip and before
    this period's first tip. ESPN rolls the period and the standings in one
    nightly run; if one moved without the other, live falls back to official
    rather than double count or skip a day."""
    if not schedule:
        return GuardResult(False, "pro-team schedule unavailable")
    games = schedule.get(period) or {}
    if not games:
        return GuardResult(True, f"no games in period {period}")
    if not standings_updated_ms:
        return GuardResult(False, "no standingsUpdateDate in the payload")
    first_tip = min(games.values())
    if standings_updated_ms >= first_tip:
        return GuardResult(False, f"standings updated after period {period} started but the period did not roll")
    previous_last_tip = _last_tip_before(period, schedule)
    if previous_last_tip is not None and standings_updated_ms <= previous_last_tip:
        return GuardResult(False, f"period rolled to {period} but standings not updated since the previous game day")
    return GuardResult(True, "ok")


def snapshot_is_safe(standings_updated_ms: Optional[int], completed_period: int,
                     schedule: Mapping[int, Mapping[str, int]]) -> GuardResult:
    """G1 for the DB sync: day ``completed_period`` may be written as a
    snapshot only once ESPN's standings were updated after that day's games.
    When it cannot tell (no schedule, no update date), it answers ok, so the
    DB sync keeps today's behaviour instead of stopping."""
    games = (schedule or {}).get(completed_period) or {}
    if not schedule or not games or not standings_updated_ms:
        return GuardResult(True, "cannot tell; writing as before")
    last_tip = max(games.values())
    if standings_updated_ms <= last_tip:
        return GuardResult(False, f"standings not yet updated after period {completed_period}'s games")
    return GuardResult(True, "ok")


def games_due_for_final_check(games: Mapping[str, int], known_final: Collection[str], now_ms: int) -> list[str]:
    """Games worth asking the scoreboard about: past 1 h 45 min after tip and
    not already seen final. Empty after the last final, so no request is made."""
    return sorted(
        game_id for game_id, tip in games.items()
        if game_id not in known_final and now_ms >= tip + FINAL_CHECK_AFTER_TIP_MS
    )


# --- reconciliation (G2) ------------------------------------------------------

def reconcile(old: pd.DataFrame, new: pd.DataFrame, overlay: LiveOverlay) -> list[dict]:
    """Guard G2: when ESPN's official totals move, ``new - old`` must equal
    the last overlay of the closed period, per team and counting stat.
    Returns the differences (empty when clean). Small ones are legitimate ESPN
    stat corrections; anything else is a bug signal."""
    expected = overlay.per_team()
    old_by_team = old.set_index('team_id')
    new_by_team = new.set_index('team_id')
    stats = [c for c in new_by_team.columns
             if c in old_by_team.columns and c not in _ID_COLUMNS and _summable(c)]
    diffs: list[dict] = []
    for team_id in new_by_team.index:
        if team_id not in old_by_team.index:
            continue
        for stat in stats:
            got = float(new_by_team.at[team_id, stat]) - float(old_by_team.at[team_id, stat])
            want = float((expected.get(int(team_id)) or {}).get(stat, 0))
            if abs(got - want) > 1e-6:
                diffs.append({
                    'team_id': int(team_id), 'stat': stat,
                    'official': _num(got), 'overlay': _num(want),
                })
    return diffs


def _num(value: float):
    return int(value) if float(value).is_integer() else round(value, 6)

"""State around the live overlay: which games are final, the shadow
reconciliation (guard G2), and what /health reports.

The arithmetic lives in ``live_overlay`` (pure). This keeps the little state
the feature needs, all in memory: the last overlay seen per period, the games
already seen final, and the last reconciliation result. A restart loses it
and the next payload rebuilds it; nothing here is ever written to the DB.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any, Awaitable, Callable, Mapping, Optional
from zoneinfo import ZoneInfo

import pandas as pd

from app.services import live_overlay as lo
from app.services.live_overlay import GuardResult, LiveOverlay

logger = logging.getLogger(__name__)

EASTERN = ZoneInfo("America/New_York")
# A reconciliation is only meaningful if the overlay it compares was taken
# after the period's games could have ended.
_COMPLETE_AFTER_LAST_TIP_MS = 4 * 60 * 60 * 1000
_KEEP_PERIODS = 3
_MAX_LOGGED_DIFFS = 20


def _now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def _iso(ms: Optional[int]) -> Optional[str]:
    if not ms:
        return None
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()


@dataclass(frozen=True)
class LiveState:
    """What a live-capable response says about tonight (plan section 4,
    "Response contract addition"). ``active`` is true once a game of ESPN's
    current period has started and the overlay is being applied; ``reason``
    says why not otherwise and is for logs, not the UI."""
    active: bool
    period: Optional[int]
    as_of: Optional[datetime]
    games_total: int
    games_live: int
    games_final: int
    official_updated_at: Optional[datetime]
    reason: str = ""

    def to_dict(self) -> dict:
        return {
            'active': self.active,
            'period': self.period,
            'as_of': self.as_of.isoformat() if self.as_of else None,
            'games_total': self.games_total,
            'games_live': self.games_live,
            'games_final': self.games_final,
            'official_updated_at': self.official_updated_at.isoformat() if self.official_updated_at else None,
        }


class LiveOverlayService:
    def __init__(self) -> None:
        self._overlay_memo: Optional[tuple[Any, LiveOverlay]] = None
        self._captured: dict[int, LiveOverlay] = {}
        self._baseline_period: Optional[int] = None
        self._final_period: Optional[int] = None
        self._final_ids: set[str] = set()
        self._last_g1: Optional[tuple[int, GuardResult]] = None
        self.last_reconcile: Optional[dict] = None

    # -- the overlay -------------------------------------------------------

    def overlay_for(self, raw: dict) -> LiveOverlay:
        """The overlay of ``raw``, built once per payload object."""
        memo = self._overlay_memo
        if memo is not None and memo[0] is raw:
            return memo[1]
        overlay = lo.build_overlay(raw)
        self._overlay_memo = (raw, overlay)
        return overlay

    # -- G1 ------------------------------------------------------------------

    def check_g1(self, raw: dict, period: int, schedule: Mapping[int, Mapping[str, int]]) -> GuardResult:
        """Guard G1 for ``period``, logged when its outcome changes."""
        result = lo.check_g1((raw.get('status') or {}).get('standingsUpdateDate'), period, schedule)
        if self._last_g1 != (period, result):
            if result.ok:
                logger.info(f"live-g1 ok: period {period} ({result.reason})")
            else:
                logger.warning(f"live-g1 fallback to official: period {period}: {result.reason}")
            self._last_g1 = (period, result)
        return result

    # -- final games -------------------------------------------------------

    def known_final(self, period: int) -> frozenset:
        return frozenset(self._final_ids) if period == self._final_period else frozenset()

    async def final_game_ids(
        self,
        period: int,
        games: Mapping[str, int],
        scoreboard: Callable[[date], Awaitable[dict]],
        now_ms: Optional[int] = None,
    ) -> frozenset:
        """Game ids of ``period`` that the site scoreboard has said are final.

        Asks only about games 1 h 45 min past tip, never again about one seen
        final, and not at all once every game is final. ``scoreboard`` is
        box_score_service.scoreboard_for, whose 60 s cache is shared with Box
        Scores, Today and matchups. A failed scoreboard call counts nothing
        new as final: averages lag, they are never wrong."""
        if period != self._final_period:
            self._final_period = period
            self._final_ids = set()
        due = lo.games_due_for_final_check(games, self._final_ids, now_ms or _now_ms())
        days = sorted({datetime.fromtimestamp(games[g] / 1000, tz=EASTERN).date() for g in due})
        for day in days:
            try:
                board = await scoreboard(day)
            except Exception as e:
                logger.warning(f"live: scoreboard for {day} unavailable: {type(e).__name__}: {e}")
                continue
            for game in board.get('games') or []:
                game_id = str(game.get('game_id') or '')
                if game.get('status') == 'final' and game_id in games:
                    self._final_ids.add(game_id)
        return frozenset(self._final_ids)

    # -- shadow run and G2 -------------------------------------------------

    def observe(
        self,
        raw: dict,
        previous: Optional[pd.DataFrame],
        current: pd.DataFrame,
        previous_from_espn: bool,
        schedule: Optional[Mapping[int, Mapping[str, int]]] = None,
    ) -> None:
        """Called with every new standings payload, whatever the flag says.

        Keeps the last overlay of each period, and when ESPN's official frame
        moves, reconciles the move against the last overlay of the period the
        old frame was published for (guard G2). Never raises: the shadow run
        must not be able to break a standings request."""
        try:
            overlay = self.overlay_for(raw)
            period = overlay.period
            if previous is None or not previous_from_espn or self._baseline_period is None:
                self._baseline_period = period
            elif current is not previous:
                self._reconcile(previous, current, period, schedule or {})
                self._baseline_period = period
            if schedule:
                self.check_g1(raw, period, schedule)
            self._captured[period] = overlay
            for old in sorted(self._captured)[:-_KEEP_PERIODS]:
                self._captured.pop(old, None)
        except Exception as e:
            logger.error(f"live shadow run failed: {type(e).__name__}: {e}", exc_info=True)

    def _reconcile(self, previous: pd.DataFrame, current: pd.DataFrame, period: int,
                   schedule: Mapping[int, Mapping[str, int]]) -> None:
        closed = self._baseline_period
        reference = self._captured.get(closed)
        result: dict = {
            'at': datetime.now(timezone.utc).isoformat(),
            'closed_period': closed,
            'official_period': period,
        }
        if reference is None:
            result.update(status='skipped', detail=f'no overlay captured for period {closed}')
            logger.warning(f"live-reconcile skipped: official moved at period {period}, "
                           f"no overlay captured for period {closed}")
            self.last_reconcile = result
            return

        diffs = lo.reconcile(previous, current, reference)
        games = schedule.get(closed) or {}
        last_tip = max(games.values()) if games else None
        as_of_ms = int(reference.as_of.timestamp() * 1000)
        complete = last_tip is None or as_of_ms >= last_tip + _COMPLETE_AFTER_LAST_TIP_MS
        if not diffs:
            status = 'ok'
        else:
            status = 'diffs' if complete else 'incomplete'
        result.update(
            status=status,
            overlay_version=reference.version,
            overlay_as_of=reference.as_of.isoformat(),
            overlay_games=len(reference.game_ids),
            period_last_tip=_iso(last_tip),
            diff_count=len(diffs),
            diffs=diffs[:_MAX_LOGGED_DIFFS],
        )
        self.last_reconcile = result
        if status == 'ok':
            logger.info(f"live-reconcile ok: period {closed}, {len(reference.game_ids)} games, "
                        f"overlay {reference.version} as of {reference.as_of.isoformat()}")
        else:
            logger.warning(f"live-reconcile {status}: period {closed}, {len(diffs)} diff(s), "
                           f"overlay as of {reference.as_of.isoformat()}: {diffs[:_MAX_LOGGED_DIFFS]}")

    # -- /health -----------------------------------------------------------

    def status(self, enabled: bool) -> dict:
        memo = self._overlay_memo
        overlay = memo[1] if memo else None
        g1 = self._last_g1
        return {
            'ok': True,
            'enabled': enabled,
            'period': overlay.period if overlay else None,
            'overlay_version': overlay.version if overlay else None,
            'overlay_as_of': overlay.as_of.isoformat() if overlay else None,
            'overlay_games': len(overlay.game_ids) if overlay else 0,
            'baseline_period': self._baseline_period,
            'final_games': len(self._final_ids),
            'g1': {'period': g1[0], 'ok': g1[1].ok, 'reason': g1[1].reason} if g1 else None,
            'last_reconcile': self.last_reconcile,
        }

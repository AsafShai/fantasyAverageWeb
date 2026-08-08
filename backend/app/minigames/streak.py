"""Streak + hint tie-break helpers (port of streakRunHints.ts)."""

from __future__ import annotations

from typing import Optional, Tuple


def on_round_win(
    current_streak: int,
    best_streak: int,
    run_hints_used: int,
    min_hints_for_best_tie: Optional[int],
) -> Tuple[int, int, Optional[int]]:
    """Return (new_current_streak, new_best_streak, new_min_hints_for_best_tie)."""
    new_streak = current_streak + 1
    if new_streak > best_streak:
        return new_streak, new_streak, run_hints_used
    if new_streak == best_streak and best_streak > 0:
        new_min = (
            run_hints_used
            if min_hints_for_best_tie is None
            else min(min_hints_for_best_tie, run_hints_used)
        )
        return new_streak, best_streak, new_min
    return new_streak, best_streak, min_hints_for_best_tie


def on_round_loss() -> Tuple[int, int]:
    """Reset current_streak and run_hints_used."""
    return 0, 0

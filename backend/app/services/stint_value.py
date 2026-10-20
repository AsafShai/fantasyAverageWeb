"""Values a player's stint on a fantasy roster against the league over the same
dates: the per-game z-score of his line there and where it would rank.

Scored the way the Player Rankings page scores (frontend utils/playerRankings):
per-game counting stats as plain z-scores, percentages as attempt-weighted
impact (pct - pool mean) * attempts per game, reverse categories negated, the
total the mean across categories, and the reference pool the top 300 of a first
pass. The pool is every player in the given logs who played enough of the
window, so a stint's rank reads like a custom-range Player Rankings page.
"""
from typing import Optional

import numpy as np

from app.models.activity_models import StintValue
from app.utils.constants import RATIO_CATEGORIES

REFERENCE_POOL_SIZE = 300
# Pool players must have played this share of the most games anyone played in
# the window, so a single hot game doesn't crowd out real regulars.
MIN_GP_SHARE = 0.25


def _z(values: np.ndarray, mean: np.ndarray, sd: np.ndarray) -> np.ndarray:
    """Column-wise z-scores; a column with no spread scores 0."""
    return np.where(sd > 0, (values - mean) / np.where(sd > 0, sd, 1.0), 0.0)


class StintValuer:
    def __init__(self, pool_logs: dict, categories: list[str], reverse: set[str], last_period: int):
        """pool_logs: player id -> list of GameLine (period, box)."""
        self.categories = categories
        self.sign = np.array([-1.0 if c in reverse else 1.0 for c in categories])
        self.ratio = {c: RATIO_CATEGORIES[c] for c in categories if c in RATIO_CATEGORIES}
        keys = sorted({k for c in categories for k in self.ratio.get(c, (c,))})
        self.col = {k: i for i, k in enumerate(keys)}
        n_periods = last_period + 2
        # Cumulative sums over periods: window totals are one subtraction.
        rows, periods, boxes = [], [], []
        for i, lines in enumerate(pool_logs.values()):
            for g in lines:
                if g.box and 0 <= g.period < n_periods:
                    rows.append(i)
                    periods.append(g.period)
                    boxes.append([g.box.get(k, 0.0) for k in keys] + [1.0])
        sums = np.zeros((len(pool_logs), n_periods, len(keys) + 1))
        if rows:
            np.add.at(sums, (np.array(rows), np.array(periods)), np.array(boxes))
        self.cum = np.concatenate([np.zeros((len(pool_logs), 1, len(keys) + 1)), np.cumsum(sums, axis=1)], axis=1)
        self._ref: dict[tuple[int, int], Optional[tuple]] = {}

    def _per_game(self, totals: np.ndarray, gp: np.ndarray, pct_means: Optional[np.ndarray] = None):
        """Per-category values for rows of window totals; percentages become
        attempt-weighted impact against pct_means (the pool's mean pct)."""
        out = np.zeros((totals.shape[0], len(self.categories)))
        pcts = np.zeros_like(out)
        for ci, c in enumerate(self.categories):
            if c in self.ratio:
                num, den = (totals[:, self.col[k]] for k in self.ratio[c])
                pcts[:, ci] = np.divide(num, den, out=np.zeros_like(num), where=den > 0)
                out[:, ci] = den / gp
            else:
                out[:, ci] = totals[:, self.col[c]] / gp
        if pct_means is None:
            pct_means = pcts.mean(axis=0)
        for ci, c in enumerate(self.categories):
            if c in self.ratio:
                out[:, ci] = (pcts[:, ci] - pct_means[ci]) * out[:, ci]
        return out, pct_means

    def _reference(self, first: int, last: int):
        key = (first, last)
        if key in self._ref:
            return self._ref[key]
        window = self.cum[:, last + 1] - self.cum[:, first]
        gp = window[:, -1]
        played = gp >= max(1.0, np.ceil(MIN_GP_SHARE * gp.max())) if len(gp) else gp > 0
        totals, gp = window[played], gp[played]
        ref = None
        if len(gp):
            vals, _ = self._per_game(totals, gp)
            z = _z(vals, vals.mean(axis=0), vals.std(axis=0)) * self.sign
            if len(gp) > REFERENCE_POOL_SIZE:
                top = np.argsort(-z.mean(axis=1), kind='stable')[:REFERENCE_POOL_SIZE]
                totals, gp = totals[top], gp[top]
            vals, pct_means = self._per_game(totals, gp)
            mean, sd = vals.mean(axis=0), vals.std(axis=0)
            z = _z(vals, mean, sd) * self.sign
            ref = (pct_means, mean, sd, np.sort(z.mean(axis=1)), np.sort(z, axis=0))
        self._ref[key] = ref
        return ref

    def value(self, first: int, last: int, games_played: int, totals: dict[str, float]) -> Optional[StintValue]:
        if games_played <= 0 or last < first:
            return None
        ref = self._reference(first, last)
        if ref is None:
            return None
        pct_means, mean, sd, sorted_total, sorted_cat = ref
        row = np.array([[totals.get(k, 0.0) for k in self.col] + [games_played]])
        vals, _ = self._per_game(row[:, :-1], row[:, -1], pct_means)
        z = _z(vals[0], mean, sd) * self.sign
        total = float(z.mean())
        n = len(sorted_total)

        def place(sorted_asc: np.ndarray, v: float) -> int:
            # 1 + how many beat v; a line below everyone ranks last.
            return min(n, n - int(np.searchsorted(sorted_asc, v, side='right')) + 1)

        return StintValue(
            rank=place(sorted_total, total),
            of=n,
            z=round(total, 2),
            cat_z={c: round(float(z[i]), 2) for i, c in enumerate(self.categories)},
            cat_rank={c: place(sorted_cat[:, i], float(z[i])) for i, c in enumerate(self.categories)},
        )

"""NumPy re-implementations of the pandas window kernels the model features use.

The serving process does not import pandas (it costs ~84 MB RSS with pyarrow),
but the feature vectors fed to the compiled models must stay bit-identical to
what the pandas training code computes. These functions reproduce pandas
3.0.x's Cython kernels operation for operation:

  * ``ewm_mean``       — ``Series.ewm(halflife=h, min_periods=m).mean()``
                         (pandas/_libs/window/aggregations.pyx::ewm, adjust=True,
                         ignore_na=False, no times)
  * ``expanding_mean`` — ``Series.expanding(min_periods=m).mean()``
                         (aggregations.pyx::roll_mean with expanding bounds:
                         Kahan-compensated sum, the GH#42064 run-of-equal-values
                         rule and the all-positive/all-negative clamps)
  * ``shift1``         — ``groupby(...).shift(1)``

Every function works on many groups at once. Groups are given as contiguous
segments ``[start, end)`` of the input (the callers sort by group first), and
the recurrences advance one position for all groups per NumPy step, so the
per-element arithmetic is exactly the scalar arithmetic pandas does — same
operations, same order, IEEE-754 float64 — while the Python loop runs only
``max(group length)`` times.

Parity with pandas is pinned by test_kernels.py (pandas is a test dependency).
"""

from __future__ import annotations

import numpy as np


def segments_from_sorted_keys(keys: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """[start, end) of each run of equal values in an already group-sorted array."""
    n = len(keys)
    if n == 0:
        return np.zeros(0, dtype=np.int64), np.zeros(0, dtype=np.int64)
    change = np.flatnonzero(keys[1:] != keys[:-1]) + 1
    starts = np.concatenate([[0], change]).astype(np.int64)
    ends = np.concatenate([change, [n]]).astype(np.int64)
    return starts, ends


def _prep(values: np.ndarray) -> np.ndarray:
    """pandas' window _prep_values: float64, +-inf treated as NaN."""
    v = np.asarray(values, dtype=np.float64)
    inf = np.isinf(v)
    if inf.any():
        v = np.where(inf, np.nan, v)
    return v


def _padded(values: np.ndarray, starts: np.ndarray, ends: np.ndarray):
    """(G, L, k) view-by-copy of the segments, plus lengths. values is (n, k)."""
    lengths = ends - starts
    L = int(lengths.max()) if len(lengths) else 0
    G = len(starts)
    k = values.shape[1]
    pos = np.arange(L)
    idx = starts[:, None] + pos[None, :]                  # (G, L)
    valid = pos[None, :] < lengths[:, None]               # (G, L)
    idx = np.where(valid, idx, 0)
    pad = values[idx] if len(values) else np.zeros((G, L, k))
    return pad, valid, lengths, L


def _unpad(out_pad: np.ndarray, valid: np.ndarray, n: int, starts: np.ndarray, k: int) -> np.ndarray:
    out = np.empty((n, k), dtype=np.float64)
    G, L = valid.shape
    idx = starts[:, None] + np.arange(L)[None, :]
    out[idx[valid]] = out_pad[valid]
    return out


def halflife_com(halflife: float) -> float:
    """pandas.core.window.ewm.get_center_of_mass for a halflife."""
    decay = 1 - np.exp(np.log(0.5) / halflife)
    comass = 1 / decay - 1
    return float(comass)


def ewm_mean(values: np.ndarray, starts: np.ndarray, ends: np.ndarray,
             halflife: float, min_periods: int = 1) -> np.ndarray:
    """Per-segment ``ewm(halflife=..., min_periods=...).mean()`` (adjust=True,
    ignore_na=False). ``values`` is (n,) or (n, k); the result has its shape."""
    v = _prep(values)
    one_d = v.ndim == 1
    if one_d:
        v = v[:, None]
    n, k = v.shape
    if n == 0:
        return np.empty(values.shape, dtype=np.float64)
    minp = max(int(min_periods), 1)
    com = halflife_com(halflife)
    alpha = 1. / (1. + com)
    old_wt_factor = 1. - alpha
    new_wt = 1.

    pad, valid, lengths, L = _padded(v, starts, ends)
    G = len(starts)
    out = np.empty((G, L, k), dtype=np.float64)

    weighted = pad[:, 0, :].copy()
    nobs = (weighted == weighted).astype(np.int64)
    out[:, 0, :] = np.where(nobs >= minp, weighted, np.nan)
    old_wt = np.ones((G, k), dtype=np.float64)

    for i in range(1, L):
        act = valid[:, i][:, None]                       # group still has a row i
        cur = pad[:, i, :]
        is_obs = cur == cur
        nobs = np.where(act, nobs + is_obs, nobs)
        w_ok = weighted == weighted
        # if weighted == weighted: (ignore_na False -> always decay)
        upd_wt = act & w_ok
        old_wt_new = np.where(upd_wt, old_wt * old_wt_factor, old_wt)
        obs_upd = upd_wt & is_obs
        differs = obs_upd & (weighted != cur)
        with np.errstate(invalid="ignore", over="ignore"):
            cand = old_wt_new * weighted + new_wt * cur
            cand = cand / (old_wt_new + new_wt)
        weighted_new = np.where(differs, cand, weighted)
        old_wt_new = np.where(obs_upd, old_wt_new + new_wt, old_wt_new)
        # elif is_observation: weighted = cur
        first_obs = act & ~w_ok & is_obs
        weighted_new = np.where(first_obs, cur, weighted_new)
        weighted = weighted_new
        old_wt = old_wt_new
        out[:, i, :] = np.where(nobs >= minp, weighted, np.nan)

    res = _unpad(out, valid, n, starts, k)
    return res[:, 0] if one_d else res


def expanding_mean(values: np.ndarray, starts: np.ndarray, ends: np.ndarray,
                   min_periods: int = 1) -> np.ndarray:
    """Per-segment ``expanding(min_periods=...).mean()`` (roll_mean kernel)."""
    v = _prep(values)
    one_d = v.ndim == 1
    if one_d:
        v = v[:, None]
    n, k = v.shape
    if n == 0:
        return np.empty(values.shape, dtype=np.float64)
    minp = max(int(min_periods), 1)

    pad, valid, lengths, L = _padded(v, starts, ends)
    G = len(starts)
    out = np.empty((G, L, k), dtype=np.float64)

    nobs = np.zeros((G, k), dtype=np.int64)
    neg_ct = np.zeros((G, k), dtype=np.int64)
    sum_x = np.zeros((G, k), dtype=np.float64)
    comp = np.zeros((G, k), dtype=np.float64)
    same = np.zeros((G, k), dtype=np.int64)
    prev = pad[:, 0, :].copy()      # setup: prev_value = values[s]

    for i in range(L):
        act = valid[:, i][:, None]
        val = pad[:, i, :]
        ok = act & (val == val)
        nobs = np.where(ok, nobs + 1, nobs)
        y = val - comp
        t = sum_x + y
        comp = np.where(ok, t - sum_x - y, comp)
        sum_x = np.where(ok, t, sum_x)
        neg_ct = np.where(ok & np.signbit(val), neg_ct + 1, neg_ct)
        same = np.where(ok, np.where(val == prev, same + 1, 1), same)
        prev = np.where(ok, val, prev)

        # calc_mean
        with np.errstate(invalid="ignore", divide="ignore"):
            result = sum_x / nobs.astype(np.float64)
        have = (nobs >= minp) & (nobs > 0)
        result = np.where(same >= nobs, prev, result)
        result = np.where((same < nobs) & (neg_ct == 0) & (result < 0), 0.0, result)
        result = np.where((same < nobs) & ~((neg_ct == 0) & (result < 0)) & (neg_ct == nobs) & (result > 0),
                          0.0, result)
        out[:, i, :] = np.where(have, result, np.nan)

    res = _unpad(out, valid, n, starts, k)
    return res[:, 0] if one_d else res


def shift1(values: np.ndarray, starts: np.ndarray, ends: np.ndarray) -> np.ndarray:
    """Per-segment shift(1): each segment's first row becomes NaN."""
    v = np.asarray(values, dtype=np.float64)
    out = np.empty_like(v)
    if len(v) == 0:
        return out
    out[1:] = v[:-1]
    out[starts] = np.nan
    return out


def ffill_segments(values: np.ndarray, starts: np.ndarray, ends: np.ndarray) -> np.ndarray:
    """Forward fill within each segment (pandas Series.ffill on each group)."""
    v = np.asarray(values, dtype=np.float64)
    n = len(v)
    if n == 0:
        return v.copy()
    idx = np.where(~np.isnan(v), np.arange(n), -1)
    seg_start = np.repeat(starts, ends - starts)
    # last valid index so far, but never before the segment start
    idx = np.maximum.accumulate(np.where(idx >= 0, idx, -1))
    out = np.where(idx >= seg_start, v[np.maximum(idx, 0)], np.nan)
    return out


def nanmedian(values: np.ndarray) -> float:
    """pandas Series.median(): NumPy median of the non-NaN values."""
    v = np.asarray(values, dtype=np.float64)
    m = v[~np.isnan(v)]
    if len(m) == 0:
        return float("nan")
    return float(np.nanmedian(m))


def _kahan_groups(values: np.ndarray, keys: np.ndarray, reset_on: str):
    """Shared loop of pandas' group_sum / group_mean (groupby.pyx): per group,
    in row order, Kahan-compensated sum of the non-NaN values.

    Returns (unique keys in ascending order, sums (G, k), nobs (G, k))."""
    v = np.asarray(values, dtype=np.float64)
    one_d = v.ndim == 1
    if one_d:
        v = v[:, None]
    order = np.argsort(keys, kind="stable")
    skeys = np.asarray(keys)[order]
    starts, ends = segments_from_sorted_keys(skeys)
    uniq = skeys[starts] if len(starts) else skeys[:0]
    pad, valid, lengths, L = _padded(v[order], starts, ends)
    G, k = len(starts), v.shape[1]
    sumx = np.zeros((G, k))
    comp = np.zeros((G, k))
    nobs = np.zeros((G, k), dtype=np.int64)
    for i in range(L):
        val = pad[:, i, :]
        ok = valid[:, i][:, None] & ~np.isnan(val)
        with np.errstate(invalid="ignore", over="ignore"):
            y = val - comp
            t = sumx + y
            c = t - sumx - y
        if reset_on == "nonfinite":
            c = np.where(np.isfinite(c), c, 0.0)
        else:
            c = np.where(c != c, 0.0, c)
        comp = np.where(ok, c, comp)
        sumx = np.where(ok, t, sumx)
        nobs = np.where(ok, nobs + 1, nobs)
    return uniq, sumx, nobs, one_d


def group_sum(values: np.ndarray, keys: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """pandas ``groupby(keys).sum()`` on float values (Kahan, NaN skipped, an
    all-NaN group sums to 0): (sorted unique keys, sums)."""
    uniq, sumx, nobs, one_d = _kahan_groups(values, keys, "nonfinite")
    return uniq, (sumx[:, 0] if one_d else sumx)


def group_mean(values: np.ndarray, keys: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """pandas ``groupby(keys).mean()`` on float values (Kahan, NaN skipped,
    an all-NaN group is NaN): (sorted unique keys, means)."""
    uniq, sumx, nobs, one_d = _kahan_groups(values, keys, "nan")
    with np.errstate(invalid="ignore", divide="ignore"):
        out = np.where(nobs == 0, np.nan, sumx / nobs)
    return uniq, (out[:, 0] if one_d else out)

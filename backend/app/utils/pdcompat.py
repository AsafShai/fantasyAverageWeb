"""pandas' numeric semantics on NumPy arrays, for code that moved off pandas.

The API's numbers and orderings must not change with the move to Polars, and
Polars' own reductions sum in a different order (and its sorts break ties
differently) than pandas. Where a result is a float that is shown, ranked or
compared, or an order that ties can affect, the app uses these helpers, which do
exactly what pandas 3 does underneath (NumPy calls in the same order):

  * nansum / nanmean / nanvar / nanstd / nanmin / nanmax — pandas.core.nanops
    (NaN filled with 0 before a NumPy sum, count of non-NaN, ...);
  * argsort — pandas.core.sorting.nargsort (Series/DataFrame.sort_values on
    one numeric column: NumPy 'quicksort', the reversed trick for descending,
    NaN last);
  * stable_argsort — the multi-key / string sorts (lexsort, Arrow sort: stable);
  * rank — Series.rank (average / min / max / first / dense, NaN kept).

app/utils/test_pdcompat.py (tests/utils) pins each one against pandas.
"""

from __future__ import annotations

import numpy as np


def as_float(values) -> np.ndarray:
    """A Polars Series / list / array as float64 with nulls as NaN."""
    if hasattr(values, "cast") and hasattr(values, "fill_null"):
        import polars as pl
        values = values.cast(pl.Float64).fill_null(float("nan")).to_numpy()
    return np.asarray(values, dtype=np.float64)


# --- reductions (pandas.core.nanops, skipna=True) --------------------------------

def nansum(values) -> float:
    v = as_float(values)
    return float(np.where(np.isnan(v), 0.0, v).sum())


def nanmean(values) -> float:
    v = as_float(values)
    mask = np.isnan(v)
    count = float(len(v) - mask.sum())
    if count == 0:
        return float("nan")
    return float(np.where(mask, 0.0, v).sum() / count)


def nanvar(values, ddof: int = 1) -> float:
    v = as_float(values)
    mask = np.isnan(v)
    count = float(len(v) - mask.sum())
    d = count - ddof
    if count == 0 or d <= 0:
        return float("nan")
    filled = np.where(mask, 0.0, v)
    avg = filled.sum(dtype=np.float64) / count
    sqr = (avg - filled) ** 2
    sqr = np.where(mask, 0.0, sqr)
    return float(sqr.sum(dtype=np.float64) / d)


def nanstd(values, ddof: int = 1) -> float:
    return float(np.sqrt(nanvar(values, ddof)))


def nanmin(values) -> float:
    v = as_float(values)
    v = v[~np.isnan(v)]
    return float(v.min()) if len(v) else float("nan")


def nanmax(values) -> float:
    v = as_float(values)
    v = v[~np.isnan(v)]
    return float(v.max()) if len(v) else float("nan")


def nanargmax(values) -> int:
    """Series.idxmax position (first of the maxima, NaN skipped); -1 if all NaN."""
    v = as_float(values)
    if np.isnan(v).all():
        return -1
    return int(np.nanargmax(v))


def nanargmin(values) -> int:
    v = as_float(values)
    if np.isnan(v).all():
        return -1
    return int(np.nanargmin(v))


# --- sorting ----------------------------------------------------------------------

def argsort(values, ascending: bool = True, na_position: str = "last") -> np.ndarray:
    """pandas.core.sorting.nargsort for a NumPy-backed column (sort_values on a
    single numeric column, kind='quicksort')."""
    items = np.asarray(values)
    if items.dtype == object or items.dtype.kind in "US":
        return stable_argsort(items, ascending=ascending)
    if items.dtype.kind == "f":
        mask = np.isnan(items)
    else:
        mask = np.zeros(len(items), dtype=bool)
    idx = np.arange(len(items))
    non_nans = items[~mask]
    non_nan_idx = idx[~mask]
    nan_idx = np.nonzero(mask)[0]
    if not ascending:
        non_nans = non_nans[::-1]
        non_nan_idx = non_nan_idx[::-1]
    indexer = non_nan_idx[non_nans.argsort(kind="quicksort")]
    if not ascending:
        indexer = indexer[::-1]
    if na_position == "last":
        return np.concatenate([indexer, nan_idx])
    return np.concatenate([nan_idx, indexer])


def stable_argsort(values, ascending: bool = True) -> np.ndarray:
    """Stable order (ties keep their input order in both directions): what
    pandas gives for multi-key sorts and for Arrow-backed string columns."""
    items = list(values)
    nulls = [i for i, v in enumerate(items) if v is None or (isinstance(v, float) and v != v)]
    null_set = set(nulls)
    keyed = [i for i in range(len(items)) if i not in null_set]
    keyed.sort(key=lambda i: items[i], reverse=not ascending)
    return np.array(keyed + nulls, dtype=np.int64)


def lexsort(keys: list, ascending: list[bool] | None = None) -> np.ndarray:
    """DataFrame.sort_values(by=[...]) on several columns: stable, NaN last."""
    n = len(keys[0]) if keys else 0
    ascending = ascending or [True] * len(keys)
    order = np.arange(n)
    for key, asc in reversed(list(zip(keys, ascending))):
        vals = list(np.asarray(key, dtype=object)[order])
        sub = stable_argsort(vals, ascending=asc)
        order = order[sub]
    return order


# --- ranking (Series.rank, na_option='keep') --------------------------------------

def rank(values, method: str = "average", ascending: bool = True) -> np.ndarray:
    v = as_float(values)
    out = np.full(len(v), np.nan)
    mask = np.isnan(v)
    idx = np.nonzero(~mask)[0]
    if len(idx) == 0:
        return out
    vals = v[idx] if ascending else -v[idx]
    # stable sort: equal values keep input order (pandas' 'first' tie rule)
    order = np.argsort(vals, kind="mergesort")
    sv = vals[order]
    new = np.empty(len(sv), dtype=bool)
    new[0] = True
    new[1:] = sv[1:] != sv[:-1]
    grp = np.cumsum(new) - 1
    starts = np.flatnonzero(new)
    ends = np.append(starts[1:], len(sv))          # exclusive
    if method == "average":
        ranks = (starts[grp] + 1 + ends[grp]) / 2.0
    elif method == "min":
        ranks = (starts[grp] + 1).astype(float)
    elif method == "max":
        ranks = ends[grp].astype(float)
    elif method == "first":
        ranks = np.arange(1, len(sv) + 1, dtype=float)
    elif method == "dense":
        ranks = (grp + 1).astype(float)
    else:
        raise ValueError(method)
    out[idx[order]] = ranks
    return out

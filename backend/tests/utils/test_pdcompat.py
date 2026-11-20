"""app/utils/pdcompat.py reproduces pandas' reductions, sort orders and ranks."""

import numpy as np
import pandas as pd
import polars as pl
import pytest

from app.utils import pdcompat


def _bits(x):
    return np.float64(x).view(np.int64)


@pytest.mark.parametrize("seed", range(5))
def test_reductions_match_pandas_bitwise(seed):
    rng = np.random.default_rng(seed)
    for n in (1, 3, 7, 8, 9, 12, 33, 129, 1000):
        v = rng.normal(0, 100, n) * rng.random(n)
        v[rng.random(n) < 0.2] = np.nan
        s = pd.Series(v)
        for name, fn in (("sum", pdcompat.nansum), ("mean", pdcompat.nanmean), ("var", pdcompat.nanvar),
                         ("std", pdcompat.nanstd), ("min", pdcompat.nanmin), ("max", pdcompat.nanmax)):
            want = getattr(s, name)()
            got = fn(v)
            assert (np.isnan(want) and np.isnan(got)) or _bits(got) == _bits(want), (name, n)
        ints = pd.Series(rng.integers(0, 50, n))
        assert _bits(pdcompat.nanmean(ints.to_numpy())) == _bits(ints.mean())


@pytest.mark.parametrize("seed", range(5))
def test_argsort_matches_sort_values(seed):
    rng = np.random.default_rng(seed)
    for n in (5, 12, 16, 17, 40, 300, 2000):
        v = rng.integers(0, 6, n).astype(float)        # many ties
        v[rng.random(n) < 0.1] = np.nan
        s = pd.Series(v)
        for asc in (True, False):
            assert list(pdcompat.argsort(v, ascending=asc)) == list(s.sort_values(ascending=asc).index)
        iv = rng.integers(0, 4, n)
        for asc in (True, False):
            assert list(pdcompat.argsort(iv, ascending=asc)) == list(pd.Series(iv).sort_values(ascending=asc).index)


def test_multi_key_and_string_sorts_match_pandas():
    rng = np.random.default_rng(1)
    n = 200
    df = pd.DataFrame({"a": rng.integers(0, 3, n), "b": rng.integers(0, 5, n).astype(float),
                       "s": rng.choice(["x", "y", "z", "w"], n)})
    for asc in ([True, True], [False, True], [True, False], [False, False]):
        want = list(df.sort_values(["a", "b"], ascending=asc).index)
        assert list(pdcompat.lexsort([df["a"].to_numpy(), df["b"].to_numpy()], asc)) == want
    for asc in (True, False):
        assert list(pdcompat.stable_argsort(df["s"].tolist(), ascending=asc)) == list(
            df["s"].sort_values(ascending=asc).index)


@pytest.mark.parametrize("method", ["average", "min", "max", "first", "dense"])
def test_rank_matches_pandas(method):
    rng = np.random.default_rng(2)
    v = rng.integers(0, 5, 60).astype(float)
    v[rng.random(60) < 0.1] = np.nan
    s = pd.Series(v)
    for asc in (True, False):
        want = s.rank(method=method, ascending=asc).to_numpy()
        got = pdcompat.rank(v, method=method, ascending=asc)
        np.testing.assert_array_equal(got, want)

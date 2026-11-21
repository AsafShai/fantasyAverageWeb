"""The NumPy kernels must match pandas bit for bit (pandas is only a test /
training dependency; production serves from kernels.py)."""

import numpy as np
import pandas as pd
import pytest

from model_stats_inference.serving import kernels


def _groups(rng, n_groups, max_len):
    lens = rng.integers(1, max_len + 1, size=n_groups)
    keys = np.repeat(np.arange(n_groups), lens)
    return keys


def _values(rng, n, kind):
    if kind == "counts":
        v = rng.integers(0, 12, size=n).astype(float)
    elif kind == "rates":
        v = rng.gamma(2.0, 0.3, size=n)
    elif kind == "signed":
        v = rng.normal(0, 3, size=n)
    elif kind == "binary":
        v = (rng.random(n) < 0.4).astype(float)
    else:
        raise ValueError(kind)
    nan = rng.random(n) < 0.15
    v[nan] = np.nan
    v[rng.random(n) < 0.01] = np.inf
    return v


def _bits(a):
    return np.asarray(a, dtype=np.float64).view(np.int64)


@pytest.mark.parametrize("seed", range(6))
@pytest.mark.parametrize("kind", ["counts", "rates", "signed", "binary"])
def test_ewm_and_expanding_match_pandas_bitwise(seed, kind):
    rng = np.random.default_rng(seed)
    keys = _groups(rng, 40, 120)
    v = _values(rng, len(keys), kind)
    s = pd.Series(v)
    starts, ends = kernels.segments_from_sorted_keys(keys)
    for hl in (2, 5, 10, 20):
        want = s.groupby(keys, sort=False).transform(lambda x: x.ewm(halflife=hl, min_periods=1).mean())
        got = kernels.ewm_mean(v, starts, ends, hl)
        np.testing.assert_array_equal(_bits(got), _bits(want.to_numpy()))
    want = s.groupby(keys, sort=False).transform(lambda x: x.expanding(min_periods=1).mean())
    got = kernels.expanding_mean(v, starts, ends)
    np.testing.assert_array_equal(_bits(got), _bits(want.to_numpy()))


def test_multicolumn_matches_single_column():
    rng = np.random.default_rng(7)
    keys = _groups(rng, 25, 60)
    m = np.column_stack([_values(rng, len(keys), k) for k in ("counts", "rates", "signed")])
    starts, ends = kernels.segments_from_sorted_keys(keys)
    both = kernels.ewm_mean(m, starts, ends, 5)
    for j in range(m.shape[1]):
        np.testing.assert_array_equal(_bits(both[:, j]), _bits(kernels.ewm_mean(m[:, j], starts, ends, 5)))
    both = kernels.expanding_mean(m, starts, ends)
    for j in range(m.shape[1]):
        np.testing.assert_array_equal(_bits(both[:, j]), _bits(kernels.expanding_mean(m[:, j], starts, ends)))


@pytest.mark.parametrize("seed", range(4))
def test_last_only_is_each_groups_last_row_of_pandas(seed):
    """last_only on a multi-column array == pandas' value at each group's last
    row (featurize asks for exactly that, all columns of a halflife at once)."""
    rng = np.random.default_rng(100 + seed)
    keys = _groups(rng, 30, 150)
    kinds = ("counts", "rates", "signed", "binary")
    m = np.column_stack([_values(rng, len(keys), k) for k in kinds])
    starts, ends = kernels.segments_from_sorted_keys(keys)
    last = ends - 1
    for hl in (2, 10):
        got = kernels.ewm_mean(m, starts, ends, hl, last_only=True)
        for j in range(m.shape[1]):
            want = pd.Series(m[:, j]).groupby(keys, sort=False).transform(
                lambda x: x.ewm(halflife=hl, min_periods=1).mean()).to_numpy()[last]
            np.testing.assert_array_equal(_bits(got[:, j]), _bits(want))
    got = kernels.expanding_mean(m, starts, ends, last_only=True)
    for j in range(m.shape[1]):
        want = pd.Series(m[:, j]).groupby(keys, sort=False).transform(
            lambda x: x.expanding(min_periods=1).mean()).to_numpy()[last]
        np.testing.assert_array_equal(_bits(got[:, j]), _bits(want))


def test_shift_ffill_median_match_pandas():
    rng = np.random.default_rng(3)
    keys = _groups(rng, 30, 20)
    v = _values(rng, len(keys), "rates")
    v[np.isinf(v)] = 1.5
    s = pd.Series(v)
    starts, ends = kernels.segments_from_sorted_keys(keys)
    np.testing.assert_array_equal(_bits(kernels.shift1(v, starts, ends)),
                                  _bits(s.groupby(keys, sort=False).shift(1).to_numpy()))
    want = s.groupby(keys, sort=False).transform(lambda x: x.ffill())
    np.testing.assert_array_equal(_bits(kernels.ffill_segments(v, starts, ends)), _bits(want.to_numpy()))
    assert kernels.nanmedian(v) == s.median()
    assert np.isnan(kernels.nanmedian(np.array([np.nan])))


def test_constant_and_edge_series():
    for v in ([3.0, 3.0, 3.0, 3.0], [np.nan, np.nan, 1.0], [0.1, 0.2, 0.30000000000000004, 0.1],
              [-1.0, -2.0, -0.5], [1e16, 1.0, -1e16, 1.0], [np.nan]):
        v = np.array(v)
        s = pd.Series(v)
        st, en = np.array([0]), np.array([len(v)])
        np.testing.assert_array_equal(_bits(kernels.expanding_mean(v, st, en)),
                                      _bits(s.expanding(min_periods=1).mean().to_numpy()))
        for hl in (1, 3, 10):
            np.testing.assert_array_equal(_bits(kernels.ewm_mean(v, st, en, hl)),
                                          _bits(s.ewm(halflife=hl, min_periods=1).mean().to_numpy()))


@pytest.mark.parametrize("seed", range(4))
def test_group_sum_mean_match_pandas_bitwise(seed):
    rng = np.random.default_rng(seed)
    n = 3000
    keys = rng.integers(0, 120, size=n)
    v = rng.normal(0, 1e3, size=n) * rng.random(n)
    v[rng.random(n) < 0.1] = np.nan
    v[keys == 7] = np.nan            # an all-NaN group
    v[rng.random(n) < 0.002] = np.inf
    s = pd.Series(v)
    uk, sums = kernels.group_sum(v, keys)
    want = s.groupby(keys).sum()
    assert list(uk) == list(want.index)
    np.testing.assert_array_equal(_bits(sums), _bits(want.to_numpy()))
    uk, means = kernels.group_mean(v, keys)
    want = s.groupby(keys).mean()
    np.testing.assert_array_equal(_bits(means), _bits(want.to_numpy()))
    m = np.column_stack([v, v * 0.37 + 1.0])
    _, sums2 = kernels.group_sum(m, keys)
    np.testing.assert_array_equal(_bits(sums2[:, 1]),
                                  _bits(pd.Series(m[:, 1]).groupby(keys).sum().to_numpy()))

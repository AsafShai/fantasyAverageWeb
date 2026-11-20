"""normal.ppf must equal scipy.stats.norm.ppf bit for bit (it replaces it in production)."""

import numpy as np
import pytest

from model_stats_inference.serving.normal import ppf

norm = pytest.importorskip("scipy.stats").norm


def _identical(a, b) -> bool:
    a, b = np.asarray(a, dtype=np.float64), np.asarray(b, dtype=np.float64)
    return bool(((a.view(np.int64) == b.view(np.int64)) | (np.isnan(a) & np.isnan(b))).all())


def test_matches_scipy_on_random_probabilities():
    x = np.random.default_rng(0).random(500_000)
    assert _identical(ppf(x), norm.ppf(x))


def test_matches_scipy_on_the_probits_surprise_feeds_it():
    # compute_zscores: (rank - 1 + 0.5) / (n_prior + 1); to_standard_normal_with: clipped to [0.5/n, 1 - 0.5/n]
    ranks = np.concatenate([(np.arange(1, n + 2) - 0.5) / (n + 1.0) for n in range(1, 400)])
    clips = np.concatenate([[0.5 / n, 1 - 0.5 / n] for n in range(1, 5000)])
    for x in (ranks, clips):
        assert _identical(ppf(x), norm.ppf(x))


def test_matches_scipy_in_deep_tails_and_branch_edges():
    rng = np.random.default_rng(1)
    tails = np.concatenate([10 ** rng.uniform(-300, -0.31, 100_000), 1 - 10 ** rng.uniform(-16, -0.31, 100_000)])
    edges = np.array([0.13533528323661269189, 1 - 0.13533528323661269189, np.exp(-32.0), 0.5])
    edges = np.concatenate([edges, np.nextafter(edges, 0), np.nextafter(edges, 1)])
    for x in (tails, edges):
        assert _identical(ppf(x), norm.ppf(x))


def test_special_values_shapes_and_scalars():
    special = np.array([0.0, 1.0, -0.5, 1.5, np.nan, np.inf, -np.inf, 5e-324])
    assert _identical(ppf(special), norm.ppf(special))
    assert ppf(np.full((3, 2), 0.2)).shape == (3, 2)
    assert ppf(0.3) == norm.ppf(0.3) and np.ndim(ppf(0.3)) == 0
    assert ppf([]).shape == (0,)

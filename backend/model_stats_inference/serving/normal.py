"""Standard-normal quantile (probit) without SciPy.

``ppf`` is a port of ``scipy.special.ndtri`` (what ``scipy.stats.norm.ppf``
calls): the Cephes routine as compiled in scipy's ``xsf`` library
(include/xsf/cephes/ndtri.h, polevl.h), same coefficients, same operations in
the same order. SciPy (~40 MB of memory once imported) is then not loaded by
production at all.

Bit-for-bit equality with SciPy is the contract (see test_normal.py). Two
details keep it: the central branch uses only + - * /, which NumPy rounds
exactly like C; the tail branches need ``log``, and NumPy's vectorized ``log``
may use SIMD code that differs from the C library's in the last bit on some
CPUs, so tail logs go through ``math.log`` (the same libm call ndtri makes).
``sqrt`` is correctly rounded everywhere.
"""

from __future__ import annotations

import math

import numpy as np

_P0 = (
    -5.99633501014107895267E1, 9.80010754185999661536E1, -5.66762857469070293439E1,
    1.39312609387279679503E1, -1.23916583867381258016E0,
)
_Q0 = (
    1.95448858338141759834E0, 4.67627912898881538453E0, 8.63602421390890590575E1, -2.25462687854119370527E2,
    2.00260212380060660359E2, -8.20372256168333339912E1, 1.59056225126211695515E1, -1.18331621121330003142E0,
)
_P1 = (
    4.05544892305962419923E0, 3.15251094599893866154E1, 5.71628192246421288162E1,
    4.40805073893200834700E1, 1.46849561928858024014E1, 2.18663306850790267539E0,
    -1.40256079171354495875E-1, -3.50424626827848203418E-2, -8.57456785154685413611E-4,
)
_Q1 = (
    1.57799883256466749731E1, 4.53907635128879210584E1, 4.13172038254672030440E1,
    1.50425385692907503408E1, 2.50464946208309415979E0, -1.42182922854787788574E-1,
    -3.80806407691578277194E-2, -9.33259480895457427372E-4,
)
_P2 = (
    3.23774891776946035970E0, 6.91522889068984211695E0, 3.93881025292474443415E0,
    1.33303460815807542389E0, 2.01485389549179081538E-1, 1.23716634817820021358E-2,
    3.01581553508235416007E-4, 2.65806974686737550832E-6, 6.23974539184983293730E-9,
)
_Q2 = (
    6.02427039364742014255E0, 3.67983563856160859403E0, 1.37702099489081330271E0, 2.16236993594496635890E-1,
    1.34204006088543189037E-2, 3.28014464682127739104E-4, 2.89247864745380683936E-6, 6.79019408009981274425E-9,
)
_SQRT2PI = 2.506628274631000502415765284811045253007
_EXP_M2 = 0.13533528323661269189  # exp(-2)


def _polevl(x, coef):
    ans = coef[0]
    for c in coef[1:]:
        ans = ans * x + c
    return ans


def _p1evl(x, coef):
    ans = x + coef[0]
    for c in coef[1:]:
        ans = ans * x + c
    return ans


def ppf(p) -> np.ndarray:
    """Quantile of the standard normal at ``p``; ``scipy.stats.norm.ppf(p)``
    for array-like or scalar input (returns a float64 array, or a NumPy float
    for a scalar). 0 -> -inf, 1 -> inf, outside [0, 1] or NaN -> NaN."""
    arr = np.asarray(p, dtype=np.float64)
    y0 = arr.reshape(-1)
    out = np.empty(y0.shape)

    # ndtri reflects the upper tail: y = 1 - y0 there, then picks a branch on y.
    # NaN, 0, 1 and anything outside [0, 1] land in neither branch below.
    y = np.where(y0 > (1.0 - _EXP_M2), 1.0 - y0, y0)
    central = np.flatnonzero(y > _EXP_M2)
    tail_mask = (y > 0.0) & (y <= _EXP_M2)
    tail = np.flatnonzero(tail_mask)

    if central.size:
        yc = y[central] - 0.5
        y2 = yc * yc
        x = yc + yc * (y2 * _polevl(y2, _P0) / _p1evl(y2, _Q0))
        out[central] = x * _SQRT2PI

    if tail.size:
        yt = y[tail]
        log_y = np.fromiter(map(math.log, yt.tolist()), dtype=np.float64, count=yt.size)
        x = np.sqrt(-2.0 * log_y)
        log_x = np.fromiter(map(math.log, x.tolist()), dtype=np.float64, count=x.size)
        x0 = x - log_x / x
        z = 1.0 / x
        x1 = np.empty_like(x)
        near = x < 8.0  # y > exp(-32); the far branch is p < 1.3e-14
        if near.all():
            x1 = z * _polevl(z, _P1) / _p1evl(z, _Q1)
        else:
            zn, zf = z[near], z[~near]
            x1[near] = zn * _polevl(zn, _P1) / _p1evl(zn, _Q1)
            x1[~near] = zf * _polevl(zf, _P2) / _p1evl(zf, _Q2)
        xt = x0 - x1
        # The lower tail is negative; the reflected upper tail keeps its sign.
        out[tail] = np.where(y0[tail] > (1.0 - _EXP_M2), xt, -xt)

    if central.size + tail.size < y0.size:
        rest = np.flatnonzero(~(tail_mask | (y > _EXP_M2)))
        v = y0[rest]
        out[rest] = np.where(v == 0.0, -np.inf, np.where(v == 1.0, np.inf, np.nan))

    if arr.ndim == 0:
        return out[0]
    return out.reshape(arr.shape)

"""Polars frames from DB rows / dicts, with the value conventions the app's
pandas code had (so outputs stay identical after the move off pandas):

  * a float column's NULL is NaN (pandas float64), not a Polars null;
  * an integer column with a NULL becomes float with NaN (pandas upcasts it);
  * Decimal (NUMERIC) values become float64;
  * dates stay dates, text stays text (NULL -> null), JSON values stay Python
    objects.

Columns are built one at a time from the records, so no per-row dict is ever
materialized (that cost ~80 MB of transient peak on a full ~96k-row history).
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Iterable, Sequence

import polars as pl

_NAN = float("nan")


def series(name: str, values: list) -> pl.Series:
    kinds = {type(v) for v in values if v is not None}
    has_null = any(v is None for v in values)
    if not kinds:
        return pl.Series(name, values, dtype=pl.Null if values else pl.Float64)
    if kinds <= {bool}:
        return pl.Series(name, values, dtype=pl.Boolean)
    if kinds <= {int}:
        if has_null:
            return pl.Series(name, [_NAN if v is None else float(v) for v in values], dtype=pl.Float64)
        return pl.Series(name, values, dtype=pl.Int64)
    if kinds <= {int, float, Decimal, bool}:
        return pl.Series(name, [_NAN if v is None else float(v) for v in values], dtype=pl.Float64)
    if kinds <= {str}:
        return pl.Series(name, values, dtype=pl.String)
    if kinds <= {date}:
        return pl.Series(name, values, dtype=pl.Date)
    if kinds <= {datetime}:
        return pl.Series(name, values, dtype=pl.Datetime("us", "UTC") if any(
            v.tzinfo for v in values if v is not None) else pl.Datetime("us"))
    return pl.Series(name, values, dtype=pl.Object)


def records_frame(records: Sequence, columns: list[str] | None = None) -> pl.DataFrame:
    """asyncpg Records (or dicts) -> DataFrame, column-wise, columns looked up by name."""
    if not records:
        return pl.DataFrame()
    if columns is None:
        columns = list(records[0].keys())
    cols = []
    for i, name in enumerate(columns):
        cols.append(series(name, [r[name] if isinstance(r, dict) else r[i] for r in records]))
    return pl.DataFrame(cols)


def dicts_frame(rows: Iterable[dict], columns: list[str] | None = None) -> pl.DataFrame:
    """List of dicts -> DataFrame (pandas ``pd.DataFrame(rows)``): columns in
    first-seen order (or ``columns``), a key missing from a row is a null."""
    rows = list(rows)
    if not rows:
        return pl.DataFrame({c: [] for c in columns}) if columns else pl.DataFrame()
    if columns is None:
        seen: dict[str, None] = {}
        for r in rows:
            for k in r:
                seen.setdefault(k, None)
        columns = list(seen)
    return pl.DataFrame([series(c, [r.get(c) for r in rows]) for c in columns])

"""Serving-side twin of research/features.py + research/data.py, without pandas.

The web process builds the "as of now" feature vectors (nightly fold-in, the
bootstrap, the vector heal) from Polars frames. The offline research/training
code keeps its pandas implementation; this module reproduces it exactly:

  * same columns in the same order, same rows in the same order;
  * every float computed with the same IEEE-754 operations in the same order
    (window sums via per-group ``np.cumsum``, pandas' EWM / expanding-mean
    kernels via kernels.py), so the vectors — and therefore the compiled
    models' predictions — are bit-identical.

test_featurize_parity.py checks that against the pandas code on generated
histories, and the golden harness (golden/) checks it on five real seasons.

Frames: ``GAME_DATE`` is ``pl.Date``; ids are integers; stats are float64.
"""

from __future__ import annotations

import numpy as np
import polars as pl

from ..research import config
from . import kernels

# --- grouping helpers -------------------------------------------------------


def _group_order(keys: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Stable order that makes groups contiguous (keeping each group's row
    order), plus the [start, end) segments in that order."""
    order = np.argsort(keys, kind="stable")
    starts, ends = kernels.segments_from_sorted_keys(keys[order])
    return order, starts, ends


def _per_group(fn, values: np.ndarray, keys: np.ndarray, *args) -> np.ndarray:
    """Apply a segment kernel group-wise in original row order (pandas
    ``groupby(keys, sort=False).transform(...)``)."""
    order, starts, ends = _group_order(keys)
    res = fn(values[order], starts, ends, *args)
    out = np.empty_like(res)
    out[order] = res
    return out


def _to_f64(s: pl.Series) -> np.ndarray:
    return s.cast(pl.Float64).to_numpy().astype(np.float64, copy=False)


def _stable_sort(df: pl.DataFrame, by: list[str]) -> pl.DataFrame:
    return df.sort(by, maintain_order=True, nulls_last=True)


def _epoch_days(dates: pl.Series) -> np.ndarray:
    return dates.cast(pl.Date).cast(pl.Int64).to_numpy()


# --- research/data.py twins ----------------------------------------------------


def to_date(df: pl.DataFrame) -> pl.DataFrame:
    """``GAME_DATE`` as pl.Date (research.data._to_datetime)."""
    if df.is_empty() and "GAME_DATE" not in df.columns:
        return df
    col = df.schema["GAME_DATE"]
    if col == pl.Date:
        return df
    if col == pl.String:
        return df.with_columns(pl.col("GAME_DATE").str.to_date(strict=False))
    return df.with_columns(pl.col("GAME_DATE").cast(pl.Date))


def build_team_allowed(team_logs: pl.DataFrame) -> pl.DataFrame:
    """research.data.build_team_allowed: each team-game with what the opponent
    did against it (ALLOWED_*), sorted by [TEAM_ID, GAME_DATE]."""
    present = [c for c in config.OPP_ALLOWED_STATS if c in team_logs.columns]
    cols = ["GAME_ID", "TEAM_ID", "GAME_DATE", "SEASON"] + present
    left = team_logs.select(cols).with_columns(
        (team_logs["FGA"] + 0.44 * team_logs["FTA"] + team_logs["TOV"]).alias("PACE_PROXY")
    )
    right = left.rename({c: f"{c}_OPP" for c in left.columns if c != "GAME_ID"})
    merged = left.join(right, on="GAME_ID", how="inner", maintain_order="left_right")
    merged = merged.filter(pl.col("TEAM_ID") != pl.col("TEAM_ID_OPP"))
    out = merged.select(
        "GAME_ID", "GAME_DATE", "SEASON", "TEAM_ID",
        pl.col("TEAM_ID_OPP").alias("OPP_TEAM_ID"),
        *[pl.col(f"{s}_OPP").alias(f"ALLOWED_{s}") for s in config.OPP_ALLOWED_STATS if s in present],
        pl.col("PACE_PROXY_OPP").alias("ALLOWED_PACE"),
    )
    return _stable_sort(out, ["TEAM_ID", "GAME_DATE"])


def build_team_own(team_logs: pl.DataFrame) -> pl.DataFrame:
    """research.data.build_team_own."""
    out = team_logs.select(
        "GAME_ID", "GAME_DATE", "SEASON", "TEAM_ID",
        *[pl.col(s).alias(f"TEAM_{s}") for s in config.TEAM_OWN_STATS],
        (pl.col("FGA") + 0.44 * pl.col("FTA") + pl.col("TOV")).alias("TEAM_PACE"),
    )
    return _stable_sort(out, ["TEAM_ID", "GAME_DATE"])


# --- research/features.py twins ------------------------------------------------


def attach_usage(players: pl.DataFrame, team_own: pl.DataFrame) -> pl.DataFrame:
    """research.features.attach_usage: add the per-game USG column."""
    if "USG" in players.columns:
        return players
    pace = team_own.select("GAME_ID", "TEAM_ID", "TEAM_PACE").unique(
        subset=["GAME_ID", "TEAM_ID"], keep="first", maintain_order=True
    )
    out = players.join(pace, on=["GAME_ID", "TEAM_ID"], how="left", maintain_order="left")
    tm_poss = _to_f64(out["TEAM_PACE"])
    out = out.drop("TEAM_PACE")
    missing = np.isnan(tm_poss)
    if missing.any():
        print(f"  WARNING: {int(missing.sum())} player-games have no team pace row; "
              "imputing the league median (check the pace_source passed in)")
        tm_poss = np.where(missing, kernels.nanmedian(tm_poss), tm_poss)

    minutes = _to_f64(out["MIN"])
    player_poss = _to_f64(out["FGA"]) + 0.44 * _to_f64(out["FTA"]) + _to_f64(out["TOV"])
    with np.errstate(divide="ignore", invalid="ignore"):
        usg = 100.0 * player_poss * (config.USG_TEAM_MINUTES / 5.0) / (minutes * tm_poss)
    usg = np.where(np.isinf(usg), np.nan, usg)
    usg = np.where(minutes >= config.MIN_MINUTES, usg, np.nan)

    if np.isnan(usg).any():
        keys = out["PLAYER_ID"].to_numpy()
        order, starts, ends = _group_order(keys)
        run = kernels.expanding_mean(usg[order], starts, ends)
        run = kernels.ffill_segments(run, starts, ends)
        running = np.empty_like(run)
        running[order] = run
        usg = np.where(np.isnan(usg), running, usg)

    med = kernels.nanmedian(usg)
    usg = np.where(np.isnan(usg), med, usg)
    usg = np.where(np.isnan(usg), 0.0, usg)
    return out.with_columns(pl.Series("USG", usg, dtype=pl.Float64))


def _window_specs() -> list[tuple[str, int | None, int | None]]:
    specs: list[tuple[str, int | None, int | None]] = [("global", None, None)]
    for name, spec in config.WINDOWS.items():
        specs.append((name, spec["games"], spec["days"]))
    return specs


def _asof_history(
    df: pl.DataFrame, group_key: str, stats: list[str], rate_stats: list[str], prefix: str
) -> pl.DataFrame:
    """research.features._asof_features: one row per group (ascending key) with
    the window aggregates over ALL its games, columns [key, GAME_DATE, feats].

    pandas appends a synthetic row per group and runs the leakage-safe window
    engine; for that row the window is [start, n) over the group's real games,
    with per-group prefix sums that start at zero. Computed here directly with
    the same prefix sums (np.cumsum along each padded group row is the same
    sequential accumulation), the same searchsorted bounds and the same
    mean/var/rate formulas.
    """
    df = _stable_sort(df, [group_key, "GAME_DATE"])
    keys = df[group_key].to_numpy()
    starts, ends = kernels.segments_from_sorted_keys(keys)
    G = len(starts)
    k = len(stats)
    lengths = ends - starts
    L = int(lengths.max()) if G else 0
    dates = _epoch_days(df["GAME_DATE"])
    vals = np.column_stack([_to_f64(df[s]) for s in stats]) if k else np.zeros((len(df), 0))
    has_min = "MIN" in df.columns
    mins = _to_f64(df["MIN"]) if has_min else None

    pos = np.arange(L)
    valid = pos[None, :] < lengths[:, None]
    idx = np.where(valid, starts[:, None] + pos[None, :], 0)
    pad = np.where(valid[:, :, None], vals[idx], 0.0)                      # (G, L, k)
    csum = np.concatenate([np.zeros((G, 1, k)), np.cumsum(pad, axis=1)], axis=1)
    csum2 = np.concatenate([np.zeros((G, 1, k)), np.cumsum(pad * pad, axis=1)], axis=1)
    if has_min:
        mpad = np.where(valid, mins[idx], 0.0)
        cmin = np.concatenate([np.zeros((G, 1)), np.cumsum(mpad, axis=1)], axis=1)
    pad_dates = np.where(valid, dates[idx], np.iinfo(np.int64).max)
    last_date = dates[ends - 1] if G else np.zeros(0, dtype=np.int64)
    n = lengths
    g_idx = np.arange(G)

    out: dict[str, np.ndarray] = {}
    for wname, games_cap, days_cap in _window_specs():
        if wname == "global":
            start = np.zeros(G, dtype=np.int64)
        else:
            # searchsorted(gd, gd[i] - days, 'left') per group, i = synthetic row
            target = last_date - days_cap
            lo = (pad_dates < target[:, None]).sum(axis=1)
            start = np.maximum(lo, n - games_cap)
        start = np.minimum(start, n)

        count = (n - start).astype(float)
        count_safe = np.where(count > 0, count, np.nan)
        ssum = csum[g_idx, n] - csum[g_idx, start]
        ssum2 = csum2[g_idx, n] - csum2[g_idx, start]
        with np.errstate(divide="ignore", invalid="ignore"):
            mean = ssum / count_safe[:, None]
            var_denom = np.where(count > 1, count - 1, np.nan)
            var = (ssum2 - (ssum * ssum) / count_safe[:, None]) / var_denom[:, None]
        if has_min:
            msum = cmin[g_idx, n] - cmin[g_idx, start]
            msum_safe = np.where(msum > 0, msum, np.nan)
        for si, s in enumerate(stats):
            out[f"{prefix}{s}_{wname}_mean"] = mean[:, si]
            out[f"{prefix}{s}_{wname}_var"] = var[:, si]
            if has_min and s in rate_stats:
                with np.errstate(divide="ignore", invalid="ignore"):
                    out[f"{prefix}{s}_{wname}_rate"] = ssum[:, si] / msum_safe

    # pandas creates the columns window by window, stat by stat (mean, var, rate)
    ordered: dict[str, np.ndarray] = {}
    for wname, _, _ in _window_specs():
        for s in stats:
            for suffix in ("mean", "var", "rate"):
                name = f"{prefix}{s}_{wname}_{suffix}"
                if name in out:
                    ordered[name] = out[name]
    first = df[[group_key, "GAME_DATE"]][ends - 1] if G else df[[group_key, "GAME_DATE"]].clear()
    return pl.concat([first, pl.DataFrame({k_: pl.Series(k_, v, dtype=pl.Float64)
                                          for k_, v in ordered.items()}, height=G)], how="horizontal")


def _efficiency_features(hist: dict[str, np.ndarray], n: int) -> dict[str, np.ndarray]:
    eff = {}
    for w in ["global", *config.WINDOWS]:
        for makes, atts, name in [("FGM", "FGA", "FG_EFF"), ("FG3M", "FG3A", "FG3_EFF"),
                                  ("FTM", "FTA", "FT_EFF")]:
            num = hist[f"{makes}_{w}_mean"]
            den = hist[f"{atts}_{w}_mean"]
            eff[f"{name}_{w}"] = np.divide(num, den, out=np.full_like(num, np.nan), where=den > 0)
    return eff


def _ewm_asof(players_sorted: pl.DataFrame, starts: np.ndarray, ends: np.ndarray) -> dict[str, np.ndarray]:
    """research.features.compute_ewm_features(shifted=False), last row per group.

    ``players_sorted`` is stably sorted by [PLAYER_ID, GAME_DATE], so groups are
    the contiguous [starts, ends) segments.
    """
    last = ends - 1
    MIN = _to_f64(players_sorted["MIN"])
    col = {c: _to_f64(players_sorted[c]) for c in players_sorted.columns
           if players_sorted.schema[c].is_numeric()}

    def ewm(values: np.ndarray, hl: int) -> np.ndarray:
        return kernels.ewm_mean(values, starts, ends, hl)[last]

    def expanding(values: np.ndarray) -> np.ndarray:
        return kernels.expanding_mean(values, starts, ends)[last]

    out: dict[str, np.ndarray] = {}
    with np.errstate(divide="ignore", invalid="ignore"):
        for stat in config.EWM_STATS:
            per_game = col[stat]
            per_min = per_game / MIN
            per_min = np.where(np.isinf(per_min), np.nan, per_min)
            has_any = (per_game >= config.EWM_SHARE_MIN.get(stat, 1)).astype(float)
            for hl in config.EWM_HALFLIVES:
                out[f"{stat}_ewm{hl}_mean"] = ewm(per_game, hl)
                out[f"{stat}_ewm{hl}_rate"] = ewm(per_min, hl)
            out[f"{stat}_share_ewm{config.EWM_SHARE_HALFLIFE}"] = ewm(has_any, config.EWM_SHARE_HALFLIFE)
            out[f"{stat}_share_global"] = expanding(has_any)
            for thr in config.EWM_SHARE_EXTRA.get(stat, []):
                ind = (col[stat] >= thr).astype(float)
                out[f"{stat}_share{thr}_ewm{config.EWM_SHARE_HALFLIFE}"] = ewm(ind, config.EWM_SHARE_HALFLIFE)
                out[f"{stat}_share{thr}_global"] = expanding(ind)

        hl = config.EWM_COMPOSITE_HALFLIFE

        def weighted(weights: dict[str, float]) -> np.ndarray:
            # Python sum() from int 0, exactly like the pandas code
            return sum(w * col[c] for c, w in weights.items())

        for name, weights in config.EWM_RATE_COMPOSITES.items():
            rate = weighted(weights) / MIN
            rate = np.where(np.isinf(rate), np.nan, rate)
            out[f"{name}_ewm{hl}_rate"] = ewm(rate, hl)
        for name, (num_w, den_w) in config.EWM_RATIO_COMPOSITES.items():
            den = weighted(den_w)
            ratio = np.where(den > 0, weighted(num_w) / den, np.nan)
            out[f"{name}_ewm{hl}"] = ewm(ratio, hl)
    return out


def _bio_block(player_ids: np.ndarray, player_bio: pl.DataFrame | None) -> dict[str, np.ndarray]:
    n = len(player_ids)
    if player_bio is None:
        return {c: np.full(n, np.nan) for c in config.BIO_COLUMNS}
    bio = player_bio.unique(subset=["PLAYER_ID"], keep="first", maintain_order=True)
    lookup = pl.DataFrame({"PLAYER_ID": pl.Series(player_ids, dtype=bio.schema["PLAYER_ID"])}).join(
        bio, on="PLAYER_ID", how="left", maintain_order="left"
    )
    return {c: _to_f64(lookup[c]) for c in config.BIO_COLUMNS}


def _last_non_null(df_sorted: pl.DataFrame, col: str) -> pl.Expr:
    return pl.col(col).drop_nulls().last()


def _player_vectors(
    players: pl.DataFrame, pace_source: pl.DataFrame, player_bio: pl.DataFrame | None
) -> pl.DataFrame:
    """research.features._player_vectors for one batch of players."""
    players = attach_usage(players, pace_source)

    p = _asof_history(players, "PLAYER_ID", config.BASE_STATS, config.RATE_STATS, "")
    pids = p["PLAYER_ID"].to_numpy()
    hist_cols = [c for c in p.columns if c not in ("PLAYER_ID", "GAME_DATE")]
    hist = {c: p[c].to_numpy() for c in hist_cols}
    eff = _efficiency_features(hist, len(p))

    sorted_players = _stable_sort(players, ["PLAYER_ID", "GAME_DATE"])
    starts, ends = kernels.segments_from_sorted_keys(sorted_players["PLAYER_ID"].to_numpy())
    ewm = _ewm_asof(sorted_players, starts, ends)   # groups ascending = p's order
    bio = _bio_block(pids, player_bio)

    block = {**hist, **eff, **ewm, **bio}
    vectors = pl.concat([
        p.select("PLAYER_ID"),
        pl.DataFrame({k: pl.Series(k, v, dtype=pl.Float64) for k, v in block.items()}, height=len(p)),
    ], how="horizontal")

    aggs = [
        pl.col("TEAM_ID").drop_nulls().last().alias("TEAM_ID"),
        pl.col("GAME_DATE").max().alias("last_game_date"),
        pl.len().cast(pl.Int64).alias("games_count"),
    ]
    if "PLAYER_NAME" in players.columns:
        aggs.append(pl.col("PLAYER_NAME").drop_nulls().last().alias("PLAYER_NAME"))
    if "POSITION" in players.columns:
        aggs.append(pl.col("POSITION").drop_nulls().last().alias("POSITION"))
    meta = sorted_players.group_by("PLAYER_ID", maintain_order=True).agg(aggs)
    return vectors.join(meta, on="PLAYER_ID", how="inner", maintain_order="left")


# Same batching as research.features.PLAYER_VECTOR_CHUNK (memory bound only;
# the output does not depend on it, but row order follows the batches).
PLAYER_VECTOR_CHUNK = 25


def load_bio() -> pl.DataFrame | None:
    if not config.BIO_PATH.exists():
        return None
    return pl.read_parquet(config.BIO_PATH)


def build_current_state(
    players: pl.DataFrame,
    team_allowed: pl.DataFrame,
    team_own: pl.DataFrame,
    player_bio: pl.DataFrame | None = None,
    pace_source: pl.DataFrame | None = None,
) -> tuple[pl.DataFrame, pl.DataFrame, pl.DataFrame]:
    """research.features.build_current_state on Polars frames:
    (player_vectors, team_allowed_vectors, team_own_vectors)."""
    if player_bio is None:
        player_bio = load_bio()
    pace = team_own if pace_source is None else pace_source

    ids = players["PLAYER_ID"].unique(maintain_order=True).to_list()
    if len(ids) == 0:
        player_vectors = _player_vectors(players, pace, player_bio)
    else:
        batches = []
        for i in range(0, len(ids), PLAYER_VECTOR_CHUNK):
            chunk = ids[i:i + PLAYER_VECTOR_CHUNK]
            batches.append(_player_vectors(
                players.filter(pl.col("PLAYER_ID").is_in(chunk)), pace, player_bio))
        player_vectors = batches[0] if len(batches) == 1 else pl.concat(batches, how="vertical")

    allowed_cols = [c for c in team_allowed.columns if c.startswith("ALLOWED_")]
    team_allowed_vectors = _asof_history(team_allowed, "TEAM_ID", allowed_cols, [], "OPP_").drop("GAME_DATE")
    own_cols = [c for c in team_own.columns if c.startswith("TEAM_") and c != "TEAM_ID"]
    team_own_vectors = _asof_history(team_own, "TEAM_ID", own_cols, [], "").drop("GAME_DATE")
    return player_vectors, team_allowed_vectors, team_own_vectors

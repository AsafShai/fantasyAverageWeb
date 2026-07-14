"""Leakage-safe feature engineering for next-game stat prediction.

Each output row is one player-game. Every history feature is computed from games
*strictly before* that game (within count + recency caps), so the target game can
never leak into its own features. The known label-time input ``t`` (minutes the
player will play) and the opponent's prior "allowed" history are added on top.

The windowing engine uses per-group prefix sums, so a window aggregate over rows
``[s, i)`` is an O(1) range query — the whole 90k-row matrix builds in seconds.
The exclusive upper bound ``i`` is what makes it leakage-safe (current game
excluded). ``s`` enforces both the game-count cap and the recency (days) cap.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from . import config

# Meta columns kept for reference / joining — never used as model features.
META_COLS = [
    "SEASON", "PLAYER_ID", "PLAYER_NAME", "TEAM_ID", "OPP_TEAM_ID",
    "GAME_ID", "GAME_DATE",
]
TARGET_PREFIX = "y_"


def _epoch_days(dt: pd.Series) -> np.ndarray:
    return dt.to_numpy(dtype="datetime64[D]").astype("int64")


def _window_specs() -> list[tuple[str, int | None, int | None]]:
    """('global', None, None) plus each configured (name, games_cap, days_cap)."""
    specs: list[tuple[str, int | None, int | None]] = [("global", None, None)]
    for name, spec in config.WINDOWS.items():
        specs.append((name, spec["games"], spec["days"]))
    return specs


def compute_history_features(
    df: pd.DataFrame,
    group_key: str,
    stats: list[str],
    rate_stats: list[str],
    prefix: str,
) -> pd.DataFrame:
    """Per group (sorted by date), shifted mean/var (+ optional per-minute rate).

    ``df`` must already be sorted by ``[group_key, 'GAME_DATE']``. Returns a frame
    aligned to ``df.index`` with columns ``{prefix}{stat}_{window}_{mean|var|rate}``.
    """
    n = len(df)
    k = len(stats)
    dates = _epoch_days(df["GAME_DATE"])
    vals = df[stats].to_numpy(dtype=float)
    mins = df["MIN"].to_numpy(dtype=float) if "MIN" in df.columns else None
    specs = _window_specs()

    out: dict[str, np.ndarray] = {}
    for wname, _, _ in specs:
        for s in stats:
            out[f"{prefix}{s}_{wname}_mean"] = np.full(n, np.nan)
            out[f"{prefix}{s}_{wname}_var"] = np.full(n, np.nan)
            if mins is not None and s in rate_stats:
                out[f"{prefix}{s}_{wname}_rate"] = np.full(n, np.nan)

    for pos in df.groupby(group_key, sort=False).indices.values():
        pos = np.asarray(pos)
        m = len(pos)
        gv = vals[pos]
        gd = dates[pos]
        csum = np.vstack([np.zeros((1, k)), np.cumsum(gv, axis=0)])
        csum2 = np.vstack([np.zeros((1, k)), np.cumsum(gv * gv, axis=0)])
        if mins is not None:
            cmin = np.concatenate([[0.0], np.cumsum(mins[pos])])
        idx = np.arange(m)

        for wname, games_cap, days_cap in specs:
            if wname == "global":
                start = np.zeros(m, dtype=int)
            else:
                lo = np.searchsorted(gd, gd - days_cap, side="left")
                start = np.maximum(lo, idx - games_cap)
            start = np.minimum(start, idx)  # window is [start, i): prior games only

            count = (idx - start).astype(float)
            count_safe = np.where(count > 0, count, np.nan)
            ssum = csum[idx] - csum[start]
            ssum2 = csum2[idx] - csum2[start]
            mean = ssum / count_safe[:, None]
            var_denom = np.where(count > 1, count - 1, np.nan)
            var = (ssum2 - (ssum * ssum) / count_safe[:, None]) / var_denom[:, None]

            for si, s in enumerate(stats):
                out[f"{prefix}{s}_{wname}_mean"][pos] = mean[:, si]
                out[f"{prefix}{s}_{wname}_var"][pos] = var[:, si]

            if mins is not None:
                msum = cmin[idx] - cmin[start]
                msum_safe = np.where(msum > 0, msum, np.nan)
                for si, s in enumerate(stats):
                    if s in rate_stats:
                        out[f"{prefix}{s}_{wname}_rate"][pos] = ssum[:, si] / msum_safe

    return pd.DataFrame(out, index=df.index)


def _ewm_series(values: pd.Series, group: pd.Series, halflife: int) -> pd.Series:
    """Per-group exponentially-weighted mean of an already-shifted series."""
    return values.groupby(group, sort=False).transform(
        lambda s: s.ewm(halflife=halflife, min_periods=1).mean()
    )


def compute_ewm_features(df: pd.DataFrame, shifted: bool = True) -> pd.DataFrame:
    """EWM block-history features (config.EWM_STAT / halflives), one row per input row.

    ``df`` must be sorted by [PLAYER_ID, GAME_DATE]. With ``shifted=True`` (training)
    each row's value uses only strictly-prior games; with ``shifted=False`` (as-of
    serving state) the row's own game is included — the last row per player is then
    the "as of now" value for predicting the *next*, unplayed game.

    Columns: {stat}_ewm{hl}_mean, {stat}_ewm{hl}_rate (per-minute), plus
    {stat}_share_ewm{hl} and {stat}_share_global (share of games with >= 1).
    The ``_rate`` suffix matters: serving auto-generates ``T_x_`` interactions
    for every rate feature.
    """
    stat = config.EWM_STAT
    group = df["PLAYER_ID"]
    per_game = df[stat].astype(float)
    per_min = (per_game / df["MIN"].astype(float)).replace([np.inf, -np.inf], np.nan)
    has_any = (per_game >= 1).astype(float)
    if shifted:
        per_game = per_game.groupby(group, sort=False).shift(1)
        per_min = per_min.groupby(group, sort=False).shift(1)
        has_any = has_any.groupby(group, sort=False).shift(1)

    out = pd.DataFrame(index=df.index)
    for hl in config.EWM_HALFLIVES:
        out[f"{stat}_ewm{hl}_mean"] = _ewm_series(per_game, group, hl)
        out[f"{stat}_ewm{hl}_rate"] = _ewm_series(per_min, group, hl)
    out[f"{stat}_share_ewm{config.EWM_SHARE_HALFLIFE}"] = _ewm_series(
        has_any, group, config.EWM_SHARE_HALFLIFE
    )
    out[f"{stat}_share_global"] = has_any.groupby(group, sort=False).transform(
        lambda s: s.expanding(min_periods=1).mean()
    )
    return out


def _bio_features(player_ids: pd.Series, player_bio: pd.DataFrame | None) -> pd.DataFrame:
    """Static bio columns aligned to ``player_ids`` (all-NaN when no artifact)."""
    if player_bio is None:
        return pd.DataFrame(
            {c: np.full(len(player_ids), np.nan) for c in config.BIO_COLUMNS},
            index=player_ids.index,
        )
    bio = player_bio.drop_duplicates("PLAYER_ID").set_index("PLAYER_ID")
    aligned = bio.reindex(player_ids.to_numpy())[config.BIO_COLUMNS]
    aligned.index = player_ids.index
    return aligned


def _opponent_features(players: pd.DataFrame, team_allowed: pd.DataFrame) -> pd.DataFrame:
    """Opponent 'allowed' history aligned to each player-game.

    Computes each team's prior allowed aggregates, then attaches them to the
    player via the *opponent* team in that game.
    """
    allowed_cols = [c for c in team_allowed.columns if c.startswith("ALLOWED_")]
    ta = team_allowed.sort_values(["TEAM_ID", "GAME_DATE"]).reset_index(drop=True)

    feats = compute_history_features(ta, "TEAM_ID", allowed_cols, rate_stats=[], prefix="OPP_")
    feats = pd.concat([ta[["GAME_ID", "TEAM_ID"]], feats], axis=1)

    # Map each player-game -> opponent team id.
    opp_map = team_allowed[["GAME_ID", "TEAM_ID", "OPP_TEAM_ID"]]
    rows = players[["GAME_ID", "TEAM_ID"]].merge(opp_map, on=["GAME_ID", "TEAM_ID"], how="left")
    opp_team = rows["OPP_TEAM_ID"].to_numpy()

    # Join opponent's allowed-history (keyed on that opponent's own team-game).
    feats = feats.rename(columns={"TEAM_ID": "OPP_TEAM_ID"})
    joined = pd.DataFrame({"GAME_ID": players["GAME_ID"].to_numpy(), "OPP_TEAM_ID": opp_team})
    joined = joined.merge(feats, on=["GAME_ID", "OPP_TEAM_ID"], how="left")
    joined.index = players.index
    return joined


def _own_team_features(players: pd.DataFrame, team_own: pd.DataFrame) -> pd.DataFrame:
    """Player's own-team offensive context (pace/scoring) over the team's prior games."""
    own_cols = [c for c in team_own.columns if c.startswith("TEAM_") and c != "TEAM_ID"]
    to = team_own.sort_values(["TEAM_ID", "GAME_DATE"]).reset_index(drop=True)

    feats = compute_history_features(to, "TEAM_ID", own_cols, rate_stats=[], prefix="")
    feats = pd.concat([to[["GAME_ID", "TEAM_ID"]], feats], axis=1)

    joined = players[["GAME_ID", "TEAM_ID"]].merge(feats, on=["GAME_ID", "TEAM_ID"], how="left")
    joined = joined.drop(columns=["GAME_ID", "TEAM_ID"])
    joined.index = players.index
    return joined


def _efficiency_features(hist: pd.DataFrame) -> pd.DataFrame:
    """Shooting %s derived as makes_mean/attempts_mean (== sum makes / sum atts),
    avoiding the 0-attempt noise of averaging raw per-game percentages."""
    eff = {}
    for w in ["global", *config.WINDOWS]:
        for makes, atts, name in [
            ("FGM", "FGA", "FG_EFF"),
            ("FG3M", "FG3A", "FG3_EFF"),
            ("FTM", "FTA", "FT_EFF"),
        ]:
            num = hist[f"{makes}_{w}_mean"].to_numpy()
            den = hist[f"{atts}_{w}_mean"].to_numpy()
            eff[f"{name}_{w}"] = np.divide(num, den, out=np.full_like(num, np.nan), where=den > 0)
    return pd.DataFrame(eff, index=hist.index)


def build_feature_matrix(
    players: pd.DataFrame,
    team_allowed: pd.DataFrame,
    team_own: pd.DataFrame,
    player_bio: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Assemble the full player-game feature matrix + targets + meta columns."""
    players = players.sort_values(["PLAYER_ID", "GAME_DATE"]).reset_index(drop=True)

    # 1) Player history features (mean/var/rate over global + windows), plus the
    #    EWM block-history features and static bio columns.
    hist = compute_history_features(players, "PLAYER_ID", config.BASE_STATS, config.RATE_STATS, "")
    ewm = compute_ewm_features(players, shifted=True)
    bio = _bio_features(players["PLAYER_ID"], player_bio)

    # 2) t and t*rate — the minutes-scaled expectations (most important features).
    t = players["MIN"].to_numpy(dtype=float)
    inter = {"T_MIN": t}
    for frame in (hist, ewm):
        for col in frame.columns:
            if col.endswith("_rate"):
                inter[f"T_x_{col}"] = t * frame[col].to_numpy()
    inter = pd.DataFrame(inter, index=players.index)

    # 3) Shooting efficiency features (player's true %s over the window).
    eff = _efficiency_features(hist)

    # 4) Context features (incl. multi-hot player position).
    g = players.groupby("PLAYER_ID")
    rest_days = g["GAME_DATE"].diff().dt.days.to_numpy()
    pos = players.get("POSITION", pd.Series("", index=players.index)).fillna("")
    ctx = pd.DataFrame(
        {
            "IS_HOME": players["MATCHUP"].str.contains("vs").astype(float).to_numpy(),
            "REST_DAYS": rest_days,
            "IS_BACK_TO_BACK": (rest_days == 1).astype(float),
            "HISTORY_GAMES": g.cumcount().to_numpy().astype(float),
            "IS_GUARD": pos.str.contains("G").astype(float).to_numpy(),
            "IS_FORWARD": pos.str.contains("F").astype(float).to_numpy(),
            "IS_CENTER": pos.str.contains("C").astype(float).to_numpy(),
        },
        index=players.index,
    )

    # 5) Opponent allowed history + own-team offensive context.
    opp = _opponent_features(players, team_allowed)
    opp_team_id = opp.pop("OPP_TEAM_ID")
    opp = opp.drop(columns=["GAME_ID"])
    own = _own_team_features(players, team_own)

    # 6) Targets + meta.
    targets = pd.DataFrame(
        {f"{TARGET_PREFIX}{s}": players[s].to_numpy() for s in config.TARGETS},
        index=players.index,
    )
    meta = pd.DataFrame(
        {
            "SEASON": players["SEASON"].to_numpy(),
            "PLAYER_ID": players["PLAYER_ID"].to_numpy(),
            "PLAYER_NAME": players["PLAYER_NAME"].to_numpy(),
            "TEAM_ID": players["TEAM_ID"].to_numpy(),
            "OPP_TEAM_ID": opp_team_id.to_numpy(),
            "GAME_ID": players["GAME_ID"].to_numpy(),
            "GAME_DATE": players["GAME_DATE"].to_numpy(),
        },
        index=players.index,
    )

    matrix = pd.concat([meta, ctx, hist, ewm, bio, eff, inter, own, opp, targets], axis=1)
    return matrix


def feature_columns(matrix: pd.DataFrame) -> list[str]:
    """Columns usable as model features (exclude meta + target columns)."""
    return [
        c for c in matrix.columns
        if c not in META_COLS and not c.startswith(TARGET_PREFIX)
    ]


# --- Current-state ("as of now") vectors for serving -----------------------

def _asof_features(
    df: pd.DataFrame, group_key: str, stats: list[str], rate_stats: list[str], prefix: str
) -> pd.DataFrame:
    """One feature row per group computed over ALL its games (including the last).

    Training rows exclude their own game; for predicting an *unplayed* next game we
    need a vector that includes the most recent game. We get it by appending a
    synthetic 'as-of' row per group (dated at the group's last game) and reusing the
    same leakage-safe engine — the synthetic row's window is every real prior game.
    """
    df = df.sort_values([group_key, "GAME_DATE"], kind="stable").reset_index(drop=True)
    synth = df.groupby(group_key, as_index=False, sort=False).tail(1)
    combined = pd.concat([df, synth], ignore_index=True)
    combined = combined.sort_values([group_key, "GAME_DATE"], kind="stable").reset_index(drop=True)

    feats = compute_history_features(combined, group_key, stats, rate_stats, prefix)
    combined = pd.concat([combined[[group_key, "GAME_DATE"]], feats], axis=1)
    # The appended synthetic row is the last row per group (stable sort keeps it after
    # the real game on the same date).
    return combined.groupby(group_key, as_index=False, sort=False).tail(1).reset_index(drop=True)


def build_current_state(
    players: pd.DataFrame,
    team_allowed: pd.DataFrame,
    team_own: pd.DataFrame,
    player_bio: pd.DataFrame | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Per-player and per-team 'as of now' vectors used by the live feature store.

    Returns (player_vectors, team_allowed_vectors, team_own_vectors):
      - player_vectors: keyed PLAYER_ID, history mean/var/rate + FG/FG3/FT_EFF +
        EWM block features + static bio, plus PLAYER_NAME, TEAM_ID (current),
        POSITION, last_game_date, games_count.
      - team_allowed_vectors: keyed TEAM_ID, OPP_ALLOWED_* features.
      - team_own_vectors:     keyed TEAM_ID, TEAM_* features.

    ``player_bio`` defaults to the committed artifact (config.BIO_PATH) when it
    exists; without it the bio columns are NaN and the models degrade gracefully.
    """
    if player_bio is None and config.BIO_PATH.exists():
        player_bio = pd.read_parquet(config.BIO_PATH)

    # Player vectors.
    p = _asof_features(players, "PLAYER_ID", config.BASE_STATS, config.RATE_STATS, "")
    hist = p.drop(columns=["PLAYER_ID", "GAME_DATE"])
    eff = _efficiency_features(hist)

    # As-of EWM state: unshifted (includes the most recent game), last row per
    # player is the current state — mirrors the synthetic-row trick above.
    sorted_players = players.sort_values(["PLAYER_ID", "GAME_DATE"], kind="stable").reset_index(drop=True)
    ewm_all = compute_ewm_features(sorted_players, shifted=False)
    ewm_all["PLAYER_ID"] = sorted_players["PLAYER_ID"]
    ewm = (
        ewm_all.groupby("PLAYER_ID", as_index=False, sort=False).tail(1)
        .set_index("PLAYER_ID")
        .reindex(p["PLAYER_ID"].to_numpy())
        .reset_index(drop=True)
    )

    bio = _bio_features(p["PLAYER_ID"], player_bio).reset_index(drop=True)
    player_vectors = pd.concat([p[["PLAYER_ID"]], hist, eff, ewm, bio], axis=1)

    gp = players.sort_values(["PLAYER_ID", "GAME_DATE"]).groupby("PLAYER_ID", sort=True)
    meta = gp.agg(
        TEAM_ID=("TEAM_ID", "last"),
        last_game_date=("GAME_DATE", "max"),
        games_count=("GAME_ID", "size"),
    ).reset_index()
    if "PLAYER_NAME" in players.columns:
        meta = meta.merge(gp["PLAYER_NAME"].last().rename("PLAYER_NAME").reset_index(), on="PLAYER_ID")
    if "POSITION" in players.columns:
        meta = meta.merge(gp["POSITION"].last().rename("POSITION").reset_index(), on="PLAYER_ID")
    player_vectors = player_vectors.merge(meta, on="PLAYER_ID")

    # Team vectors.
    allowed_cols = [c for c in team_allowed.columns if c.startswith("ALLOWED_")]
    ta = _asof_features(team_allowed, "TEAM_ID", allowed_cols, [], "OPP_")
    team_allowed_vectors = ta.drop(columns=["GAME_DATE"])

    own_cols = [c for c in team_own.columns if c.startswith("TEAM_") and c != "TEAM_ID"]
    to = _asof_features(team_own, "TEAM_ID", own_cols, [], "")
    team_own_vectors = to.drop(columns=["GAME_DATE"])

    return player_vectors, team_allowed_vectors, team_own_vectors

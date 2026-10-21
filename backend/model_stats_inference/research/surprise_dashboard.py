"""Standalone local dashboard for the surprise-metric research.

Reads ONLY research/data/walkforward_<season>.parquet (the walk-forward df) —
completely separate from the backend app/server.

Run it with (no project-dependency changes; streamlit/plotly are ephemeral):

    cd backend
    uv run --with streamlit --with plotly streamlit run \
        model_stats_inference/research/surprise_dashboard.py

Four metrics, all built from the pre-normalized NORM_ columns (mean 0 / var 1):

  Metric 1 — Z-SURPRISE: volume surprise, minutes-blind. Weighted sum of the
             z-score columns; the user weighs each stat AND each window
             (all-data / season / last-10 / last-5).
  Metric 2 — MODEL-ERROR SURPRISE: surprise vs what the model expected given
             the minutes he actually played. Weighted sum of NORM_ERR_ columns.
  2-UNIT SCATTER: metric 1 vs metric 2 per player-game.
  FINAL: W1 * metric1 + W2 * metric2.

The sign IS the verdict: positive = good surprise, negative = bad surprise.
Each metric divides by the sum of |weights| so its scale stays comparable when
weights change.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st

DATA_PATH = Path(__file__).parent / "data" / "walkforward_2025_26.parquet"

Z_WINDOWS = {"All data": "ALL", "This season": "SEASON", "Last 10": "L10", "Last 5": "L5"}

# Default window weights: lean on recent form. All-data is the weakest "who is
# he" anchor; this-season and last-10 carry the most; last-5 a lighter hot/cold
# read.
WINDOW_DEFAULTS = {"ALL": 0.5, "SEASON": 1.0, "L10": 1.0, "L5": 0.5}

# Three z families in the df; Pearson/percentile fix "bad players always win
# raw z" (a scrub's tiny std explodes his z on any decent night).
Z_BASES = {
    "Raw z  ·  (x−mean)/std": "Z",
    "Pearson z  ·  (x−mean)/√(mean+1) — star-fair": "PZ",
    "Percentile (probit) — rank among his own games": "QZ",
}

# Default stat weights: hybrid of make-VOLUME and binomial EFFICIENCY so an
# all-time scoring line rises from the weights themselves (no scoring-floor hack).
# PTS (1.0) anchors scoring; FGM (1.1) and FTM (1.0) carry make-volume so a monster
# line (83 pts on 20 FG + 36 FT makes) tops naturally; the binomial shooting z's
# FG_PCT/FG3_PCT/FT_PCT add luck-adjusted efficiency (a cold 0/9 or 2/16 stays
# strongly negative and sinks). FGA/FTA left at 0 (attempts covered by makes +
# binomial %); all active weights positive. Verified: top = Adebayo/Rupert/Payne,
# bottom = Kevin Porter 0/9 and other cold lines. (Positive-side model-error is
# dialed down to W2p=0.35 below so the raw scoring line wins the very top.)
Z_DEFAULTS = {
    "PTS": 1.0, "FGM": 0.5, "FTM": 0.5, "REB": 1.0, "AST": 1.0,
    "STL": 1.0, "BLK": 1.0, "FG_PCT": 0.50, "FG3M": 0.40, "FG3_PCT": 0.0,
    "FT_PCT": 0.35, "FGA": 0.0, "FTA": 0.0,
    "TOV": 0.0, "MIN": 0.0, "OREB": 0.0, "DREB": 0.0, "FG3A": 0.0,
    "PF": 0.0, "PLUS_MINUS": 0.0,
}
# Model-error surprise: scoring/makes-dominant like Metric 1, so the big
# performances (Adebayo/Rupert) top this metric too — not just Metric 1. PTS +
# makes (FGM/FTM) lead; FGA/FTA stay NEGATIVE (efficiency rule) but SMALL (−0.15)
# so a huge-volume scoring night isn't buried by its attempt count, while cold
# chuckers still sink (their makes-error is already negative). Verified: Metric 2
# alone tops Adebayo/Rupert, bottom stays cold lines (2/16, 1/5, 0/9).
ERR_DEFAULTS = {
    "PTS": 1.0, "FGM": 0.5, "FTM": 0.5, "REB": 1.0, "AST": 1.0,
    "STL": 1.0, "BLK": 1.0, "FG3M": 0.65, "FG_PCT": 0.20, "FT_PCT": 0.20,
    "FGA": -0.10, "FTA": -0.10,
}

# Reference palette (dataviz skill): diverging blue/red poles + chart chrome.
POS, NEG = "#2a78d6", "#e34948"
SURFACE, GRID, BASELINE, INK, MUTED = "#fcfcfb", "#e1e0d9", "#c3c2b7", "#0b0b0b", "#898781"

HOVER = (
    "<b>%{customdata[0]}</b><br>MIN %{customdata[1]:.0f} · "
    "%{customdata[2]:.0f}p %{customdata[3]:.0f}r %{customdata[4]:.0f}a<br>"
    "%{customdata[5]}: %{y:.2f}<extra></extra>"
)


@st.cache_data
def load_df() -> pd.DataFrame:
    df = pd.read_parquet(DATA_PATH)
    df["GAME_DATE"] = pd.to_datetime(df["GAME_DATE"])
    return df


def weighted_metric(df: pd.DataFrame, col_weights: dict[str, float]) -> pd.Series:
    """Sum(w * NORM_col) / sum(|w|); NaN components contribute 0, rows where
    every weighted component is NaN stay NaN."""
    total = sum(abs(w) for w in col_weights.values() if w)
    if total == 0:
        return pd.Series(np.nan, index=df.index)
    acc = pd.Series(0.0, index=df.index)
    any_valid = pd.Series(False, index=df.index)
    for col, w in col_weights.items():
        if not w or col not in df.columns:
            continue
        acc = acc + df[col].fillna(0.0) * w
        any_valid = any_valid | df[col].notna()
    return (acc / total).where(any_valid)


# Grid labels differ by metric: Metric 1's FG%/FT%/3P% ARE the binomial shooting
# z's; Metric 2's are the model's percentage prediction error (NOT binomial), so
# they must not be labeled "(binom)".
_BASE_LABELS = {"FG3M": "3PM", "FG3A": "3PA", "PLUS_MINUS": "+/-"}
Z_LABELS = {**_BASE_LABELS, "FG_PCT": "FG% (binom)", "FT_PCT": "FT% (binom)",
            "FG3_PCT": "3P% (binom)"}
ERR_LABELS = {**_BASE_LABELS, "FG_PCT": "FG% (model-err)", "FT_PCT": "FT% (model-err)"}


def weight_grid(stats: dict[str, float], key_prefix: str, labels: dict | None = None,
                n_cols: int = 6) -> dict[str, float]:
    """A compact grid of per-stat weight inputs; returns stat -> weight.

    Seeds session_state once (so the Auto-balance button can overwrite the
    values before the widgets render) and reads through the key thereafter.
    """
    labels = labels or {}
    for stat, default in stats.items():
        st.session_state.setdefault(f"{key_prefix}_{stat}", default)
    weights: dict[str, float] = {}
    cols = st.columns(n_cols)
    for i, stat in enumerate(stats):
        with cols[i % n_cols]:
            weights[stat] = st.number_input(
                labels.get(stat, stat), min_value=-3.0, max_value=3.0, step=0.05,
                key=f"{key_prefix}_{stat}",
            )
    return weights


def style(fig: go.Figure, ytitle: str, xtitle: str = "") -> go.Figure:
    fig.update_layout(
        plot_bgcolor=SURFACE, paper_bgcolor=SURFACE,
        font=dict(family="system-ui, -apple-system, 'Segoe UI', sans-serif", color=INK, size=13),
        margin=dict(l=50, r=20, t=30, b=40), height=420,
        legend=dict(orientation="h", yanchor="bottom", y=1.0, x=0),
        hoverlabel=dict(bgcolor="#ffffff", font_color=INK, bordercolor=GRID),
    )
    # A click is only a "show me this player" event — never let plotly's
    # selection styling dim the other dots (which reads as the plot freezing on
    # one point). Keep selected/unselected markers identical to normal.
    fig.update_traces(
        selected=dict(marker=dict(opacity=1.0)),
        unselected=dict(marker=dict(opacity=1.0)),
    )
    fig.update_xaxes(title=xtitle, gridcolor=GRID, zerolinecolor=BASELINE, zerolinewidth=1,
                     linecolor=BASELINE, tickfont=dict(color=MUTED))
    fig.update_yaxes(title=ytitle, gridcolor=GRID, zerolinecolor=BASELINE, zerolinewidth=1,
                     linecolor=BASELINE, tickfont=dict(color=MUTED))
    return fig


def custom(d: pd.DataFrame, label: str) -> np.ndarray:
    # last slot = the row's df index, so a click can find the full box-score line
    return np.stack([
        d["PLAYER_NAME"], d["MIN"], d["PTS"], d["REB"], d["AST"],
        np.repeat(label, len(d)), d.index.astype(str),
    ], axis=1)


PLOT_CAP = 4000  # max dots drawn per chart (SVG lag / browser freeze above this)


def rank_scatter(d: pd.DataFrame, col: str, label: str, always=None) -> go.Figure:
    """One-unit view: players ranked by the metric, sign carries the verdict.

    The x-position is the TRUE rank over all rows; for big views (e.g. all
    evenings) only ~PLOT_CAP dots are drawn — this chart's own extremes kept,
    the flat middle thinned — so the shape and clickable tails survive without
    painting 20k+ points. ``always`` is an index of rows to keep no matter what
    (the notable top/bottom players), so a specific player never vanishes from a
    chart where he happens to sit mid-distribution."""
    d = d.dropna(subset=[col]).sort_values(col)
    d = d.assign(_rank=np.arange(len(d)))
    if len(d) > PLOT_CAP:
        keep_tail = 400
        head, tail = d.iloc[:keep_tail], d.iloc[-keep_tail:]
        mid = d.iloc[keep_tail:-keep_tail]
        step = max(1, len(mid) // (PLOT_CAP - 2 * keep_tail))
        parts = [head, mid.iloc[::step], tail]
        if always is not None:
            parts.append(mid.loc[mid.index.intersection(always)])  # never drop these
        d = pd.concat(parts)
        d = d[~d.index.duplicated()].sort_values(col)
    fig = go.Figure()
    for name, color, mask in [
        ("Positive surprise", POS, d[col] >= 0),
        ("Negative surprise", NEG, d[col] < 0),
    ]:
        part = d[mask]
        fig.add_trace(go.Scatter(
            x=part["_rank"], y=part[col], mode="markers", name=name,
            marker=dict(color=color, size=8, line=dict(color=SURFACE, width=1)),
            customdata=custom(part, label), hovertemplate=HOVER,
        ))
    return style(fig, ytitle=label, xtitle="players (ranked by metric)")


def _shot_line(made: float, att: float) -> str:
    pct = f" ({made / att:.0%})" if att and att > 0 else ""
    return f"{made:.0f}/{att:.0f}{pct}"


def _tile(col, label: str, value: str) -> None:
    """A stat tile rendered as markdown — unlike st.metric it never truncates the
    value with an ellipsis (which cut "6/6 (100%)" to "6/6 (100...")."""
    col.markdown(
        f"<div style='font-size:12px;color:#898781;font-weight:600'>{label}</div>"
        f"<div style='font-size:20px;font-weight:600;white-space:nowrap'>{value}</div>",
        unsafe_allow_html=True)


@st.dialog("Full night", width="large")
def stat_dialog(r: pd.Series) -> None:
    """The player's full box score, metric-free, in a popup box."""
    st.markdown(f"### {r['PLAYER_NAME']}")
    st.caption(f"{r['MATCHUP']} · {pd.Timestamp(r['GAME_DATE']).date()} · "
               f"{r['MIN']:.0f} minutes")
    top = st.columns(6)
    for c, stat in zip(top, ["PTS", "REB", "AST", "STL", "BLK", "TOV"]):
        _tile(c, stat, f"{r[stat]:.0f}")
    st.divider()
    # Shooting on its own row of 3 wide columns so the "(100%)" never gets cut.
    fg = st.columns(3)
    _tile(fg[0], "FG", _shot_line(r["FGM"], r["FGA"]))
    _tile(fg[1], "3P", _shot_line(r["FG3M"], r["FG3A"]))
    _tile(fg[2], "FT", _shot_line(r["FTM"], r["FTA"]))
    st.write("")
    bot = st.columns(3)
    _tile(bot[0], "OREB / DREB", f"{r['OREB']:.0f} / {r['DREB']:.0f}")
    _tile(bot[1], "PF", f"{r['PF']:.0f}")
    _tile(bot[2], "+/-", f"{r['PLUS_MINUS']:+.0f}")


def chart_with_card(fig: go.Figure, key: str, data: pd.DataFrame) -> None:
    """Render a chart; clicking a dot opens that player's night in a dialog.

    Each chart remembers its own last-clicked row (``_seen[key]``), so a
    selection that merely persists across an unrelated rerun never re-fires.
    A per-run guard (``_dialog_run``) guarantees at most one dialog opens in a
    single run — several charts can hold selections at once, and without this
    two of them would emit dialogs with the same auto ID.
    """
    seen = st.session_state.setdefault("_seen", {})
    ev = st.plotly_chart(fig, width="stretch", key=key, on_select="rerun",
                         selection_mode="points")
    points = ev.selection.points if ev and ev.selection else []
    rid = int(float(points[0]["customdata"][6])) if points else None

    is_new_click = rid is not None and rid != seen.get(key)
    seen[key] = rid
    if is_new_click and rid in data.index and not st.session_state.get("_dialog_run"):
        st.session_state["_dialog_run"] = True
        stat_dialog(data.loc[rid])
    if rid is None:
        st.caption("Click a dot to open that player's full night.")


def _i(v) -> str:
    return str(int(v)) if pd.notna(v) else "–"


def _ma(m, a) -> str:
    return f"{_i(m)}/{_i(a)}"


# header, cell-renderer(row), column width. FG/3P/FT show made/attempts.
_TABLE_COLS = [
    ("MIN", lambda r: _i(r["MIN"]), 0.8),
    ("PTS", lambda r: _i(r["PTS"]), 0.8),
    ("REB", lambda r: _i(r["REB"]), 0.8),
    ("AST", lambda r: _i(r["AST"]), 0.8),
    ("STL", lambda r: _i(r["STL"]), 0.8),
    ("BLK", lambda r: _i(r["BLK"]), 0.8),
    ("TOV", lambda r: _i(r["TOV"]), 0.8),
    ("FG", lambda r: _ma(r["FGM"], r["FGA"]), 1.2),
    ("3P", lambda r: _ma(r["FG3M"], r["FG3A"]), 1.2),
    ("FT", lambda r: _ma(r["FTM"], r["FTA"]), 1.2),
    ("PF", lambda r: _i(r["PF"]), 0.8),
]
_TABLE_TOTAL_W = sum(w for _, _, w in _TABLE_COLS)


def _stat_cells(values, size: int, color: str, weight: str) -> str:
    """One HTML string of right-aligned, proportionally-sized stat cells — so a
    whole row's stats render as a SINGLE markdown call instead of one per column
    (that widget-per-cell fan-out is what made the dashboard lag)."""
    return "".join(
        f"<span style='display:inline-block;width:{w / _TABLE_TOTAL_W * 100:.2f}%;"
        f"text-align:right;font-size:{size}px;font-weight:{weight};color:{color};"
        f"font-variant-numeric:tabular-nums'>{v}</span>"
        for v, (_, _, w) in zip(values, _TABLE_COLS))


def clickable_table(data: pd.DataFrame, key_prefix: str,
                    pos_thr: float = 1.8, neg_thr: float = 1.8) -> None:
    """Full-line table whose player NAME is a link — click it to pop the full
    night. No selection checkbox, so nothing stays ticked (shares the one-dialog
    guard). Each row is just 3 widgets (columns + name button + one stats
    markdown) to keep reruns fast; FG/3P/FT as made/attempts. A row is flagged
    "worth mentioning" (colored tint + ● bullet) when its final metric is
    >= ``pos_thr`` (good) or <= -``neg_thr`` (bad)."""
    head = st.columns([2.4, _TABLE_TOTAL_W], vertical_alignment="center")
    head[0].markdown("<div style='color:#898781;font-size:11px;font-weight:600'>PLAYER</div>",
                     unsafe_allow_html=True)
    head[1].markdown(_stat_cells([lbl for lbl, _, _ in _TABLE_COLS], 11, "#898781", "600"),
                     unsafe_allow_html=True)
    for pos in range(len(data)):
        r = data.iloc[pos]
        mf = r["METRIC_FINAL"] if "METRIC_FINAL" in data.columns else np.nan
        flag = pd.notna(mf) and (mf >= pos_thr or mf <= -neg_thr)   # "worth mentioning"
        col = POS if pd.notna(mf) and mf >= 0 else NEG
        row = st.columns([2.4, _TABLE_TOTAL_W], vertical_alignment="center")
        label = f"● {r['PLAYER_NAME']}" if flag else str(r["PLAYER_NAME"])
        if row[0].button(label, key=f"{key_prefix}_{pos}",
                         type="tertiary", width="stretch"):
            if not st.session_state.get("_dialog_run"):
                st.session_state["_dialog_run"] = True
                stat_dialog(r)
        cells = _stat_cells([render(r) for _, render, _ in _TABLE_COLS], 15,
                            col if flag else "inherit", "700" if flag else "400")
        bg = f"background:{col}22;border-radius:6px;" if flag else ""
        row[1].markdown(f"<div style='{bg}'>{cells}</div>", unsafe_allow_html=True)


st.set_page_config(page_title="Surprise research", layout="wide")
df = load_df()
st.session_state["_dialog_run"] = False   # reset the one-dialog-per-run guard

# --- Sidebar: evening filter -------------------------------------------------

st.sidebar.title("Surprise research")
# Reset every weight widget to the code defaults. Streamlit keeps a session's
# widget values across reloads, so after the defaults change in code this button
# is how you pull the new ones in without restarting the server.
if st.sidebar.button("↺ Reset all weights to defaults"):
    for k in [k for k in st.session_state if k.startswith(("z_", "err_", "win_"))]:
        del st.session_state[k]
    st.rerun()
dates = sorted(df["GAME_DATE"].dt.date.unique(), reverse=True)
evening = st.sidebar.selectbox("Evening", ["All evenings"] + [str(d) for d in dates])
only_pred = st.sidebar.checkbox("Only players with a model estimate", value=False)
min_minutes = st.sidebar.slider("Min minutes played tonight", 0, 30, 0)
st.sidebar.caption("Worth-mentioning thresholds (N(0,1) scale = SDs from average)")
pos_threshold = st.sidebar.slider("😇 good — flag final ≥", 1.0, 3.0, 1.8, 0.05)
neg_threshold = st.sidebar.slider("💩 bad — flag final ≤ −", 1.0, 3.0, 1.8, 0.05)

view = df if evening == "All evenings" else df[df["GAME_DATE"].dt.date.astype(str) == evening]
if only_pred:
    view = view[view["ELIGIBLE"]]
if min_minutes:
    view = view[view["MIN"] >= min_minutes]
st.sidebar.caption(f"{len(view):,} player-games · {int(view['ELIGIBLE'].sum()):,} with estimates")

# Small "what's in this slice" line at the top — filled in after the final metric
# is computed (section 4) so it can include the worth-mentioning counts.
_n_games = int(view["GAME_ID"].nunique())
_n_players = int(view["PLAYER_ID"].nunique())
_when = "All evenings" if evening == "All evenings" else pd.Timestamp(evening).strftime("%b %-d, %Y")
_topline = st.empty()
_topline.caption(f"🏀 **{_when}** · {_n_games:,} games · {_n_players:,} players")

# --- Metric 1: z-score surprise ---------------------------------------------

st.header("1 · Z-surprise (volume, minutes-blind)")
st.caption("Was tonight's stat line expected or not, against the player's own "
           "distributions? Positive = better than his usual self.")
basis_label = st.radio("Surprise basis", list(Z_BASES), index=1, horizontal=True,
                       help="Raw z over-rewards low-volume players (tiny stds). "
                            "Pearson z lets variance follow the mean; percentile "
                            "asks how rare tonight was among his own games.")
basis = Z_BASES[basis_label]
vol_weight = st.checkbox(
    "Volume-weight by minutes played tonight (×√(MIN/30))", value=True,
    help="Damps surprises that happened in tiny minutes — a scrub's 8-minute "
         "outburst counts less than a starter's 36-minute one. On by default: "
         "without it a low-minutes multi-cat spike can outrank a 50-point game.")
with st.expander("Metric 1 weights — windows and stats", expanded=False):
    st.markdown("**Window weights**")
    wcols = st.columns(len(Z_WINDOWS))
    win_w = {}
    for c, (label, suffix) in zip(wcols, Z_WINDOWS.items()):
        with c:
            win_w[suffix] = st.number_input(
                label, 0.0, 3.0, WINDOW_DEFAULTS[suffix], 0.25, key=f"win_{suffix}")
    st.markdown("**Stat weights** (negative = the stat counts against, e.g. TOV)")
    z_w = weight_grid(Z_DEFAULTS, "z", Z_LABELS)

m1_weights = {
    f"NORM_{basis}_{suffix}_{stat}": ww * sw
    for suffix, ww in win_w.items() if ww
    for stat, sw in z_w.items() if sw
}
view = view.copy()
view["METRIC_Z"] = weighted_metric(view, m1_weights)
if vol_weight:
    view["METRIC_Z"] = view["METRIC_Z"] * np.sqrt(view["MIN"] / 30.0)

# The notable players (top/bottom volume surprise, e.g. Adebayo/Rupert). Kept in
# EVERY chart's subsample so they never vanish from a chart where they sit
# mid-distribution (e.g. their model-error is unremarkable).
_z = view["METRIC_Z"].dropna()
KEEP = _z.nlargest(300).index.union(_z.nsmallest(300).index) if len(_z) else view.index[:0]

chart_with_card(rank_scatter(view, "METRIC_Z", "Z-surprise", always=KEEP), "chart_z", view)

# --- Metric 2: model-error surprise ------------------------------------------

st.header("2 · Model-error surprise (given his minutes)")
st.caption("Actual minus what the model expected for the minutes he actually "
           "played — surprise in production, not in volume. Only rows with an "
           "estimate (≥10 qualifying games this season).")
with st.expander("Metric 2 weights — model-error stats", expanded=False):
    err_w = weight_grid(ERR_DEFAULTS, "err", ERR_LABELS)

m2_weights = {f"NORM_ERR_{stat}": w for stat, w in err_w.items() if w}
view["METRIC_ERR"] = weighted_metric(view, m2_weights)
chart_with_card(rank_scatter(view, "METRIC_ERR", "Model-error surprise", always=KEEP), "chart_err", view)

# --- Two-unit scatter ---------------------------------------------------------

st.header("3 · Z-surprise vs model-error surprise")
st.caption("Each dot is a player-game. Top-right: surprised on both axes; "
           "off-diagonal: volume surprise the model already expected (or vice versa).")
both = view.dropna(subset=["METRIC_Z", "METRIC_ERR"])
if len(both) > PLOT_CAP:   # thin the cloud for big views so it paints fast
    thinned = both.iloc[:: (len(both) // PLOT_CAP) + 1]
    extra = both.loc[both.index.intersection(KEEP)]   # keep notable players
    both = pd.concat([thinned, extra])
    both = both[~both.index.duplicated()]
fig3 = go.Figure(go.Scatter(
    x=both["METRIC_Z"], y=both["METRIC_ERR"], mode="markers",
    marker=dict(color=POS, size=8, line=dict(color=SURFACE, width=1)),
    customdata=custom(both, "Z vs ERR"),
    hovertemplate=("<b>%{customdata[0]}</b><br>MIN %{customdata[1]:.0f} · "
                   "%{customdata[2]:.0f}p %{customdata[3]:.0f}r %{customdata[4]:.0f}a<br>"
                   "Z-surprise %{x:.2f} · model-error %{y:.2f}<extra></extra>"),
    name="player-game", showlegend=False,
))
chart_with_card(style(fig3, ytitle="Model-error surprise", xtitle="Z-surprise"),
                "chart_2d", both)

# --- Final weighted metric ----------------------------------------------------

st.header("4 · Final surprise  (piecewise by sign)")
st.caption("The blend differs by sign so BOTH ends read right. On the positive "
           "side, model-error adds value (approved top unchanged). On the negative "
           "side the z-surprise dominates — it nails genuinely bad lines, so airballs "
           "and 0-fers sink below efficient off-nights instead of stars who merely "
           "underperformed the model's high bar.")
pc = st.columns(4)
w1p = pc[0].number_input("W1 · z  (positive side)", 0.0, 3.0, 0.49, 0.05)
w2p = pc[1].number_input("W2 · model-err  (positive)", 0.0, 3.0, 1.20, 0.05)
w1n = pc[2].number_input("W1 · z  (negative side)", 0.0, 3.0, 1.10, 0.05)
w2n = pc[3].number_input("W2 · model-err  (negative)", 0.0, 3.0, 0.20, 0.05)

def _final_on(frame: pd.DataFrame) -> pd.Series:
    """The piecewise final metric on any frame, using the current weights."""
    mz = weighted_metric(frame, m1_weights)
    if vol_weight:
        mz = mz * np.sqrt(frame["MIN"] / 30.0)
    me = weighted_metric(frame, m2_weights)
    fp = (w1p * mz + w2p * me) / ((abs(w1p) + abs(w2p)) or 1.0)
    fn = (w1n * mz + w2n * me) / ((abs(w1n) + abs(w2n)) or 1.0)
    return fp.where(fp >= 0, fn)


view["METRIC_FINAL"] = _final_on(view)

# Optional: map the final metric onto a standard normal N(0,1). This is a
# rank-based inverse-normal transform over ALL the data — Φ⁻¹((rank−0.5)/N) — so
# it's strictly monotonic (the ranking order never changes) and the output is
# ~N(0,1). Recomputed live as weights change (fast enough to stay dynamic).
normalize = st.checkbox(
    "Normalize final to a standard normal N(0,1) — same ranking, N(0,1) scale",
    value=True,
    help="Rank-based inverse-normal transform over the whole dataset: each final "
         "value → Φ⁻¹((rank−0.5)/N). Monotonic, so the order is identical; only "
         "the scale becomes ~N(0,1). Even in a single-evening view the scores are "
         "relative to the full-season distribution.")
if normalize:
    from scipy.stats import norm
    full = _final_on(df).dropna()
    if len(full):
        ranks = full.rank(method="average")
        normed = pd.Series(norm.ppf((ranks - 0.5) / len(full)), index=full.index)
        view["METRIC_FINAL"] = normed.reindex(view.index)

chart_with_card(rank_scatter(view, "METRIC_FINAL",
                             "Final surprise (N(0,1))" if normalize else "Final surprise",
                             always=KEEP), "chart_final", view)

# Fill the top line with the worth-mentioning counts (final metric past the
# separate good / bad thresholds).
_mf = view["METRIC_FINAL"]
_good = int((_mf >= pos_threshold).sum())
_bad = int((_mf <= -neg_threshold).sum())
_topline.caption(
    f"🏀 **{_when}** · {_n_games:,} games · {_n_players:,} players  ·  "
    f"😇 {_good} worth mentioning (≥{pos_threshold:g}) · "
    f"💩 {_bad} to call out (≤−{neg_threshold:g})")

# --- Top surprises tables (ranked by the final metric; click a player's name to
#     open their full night) -------------------------------------------------------

ranked = view.dropna(subset=["METRIC_FINAL"]).sort_values("METRIC_FINAL", ascending=False)
n_rows = st.slider("Rows per table", 5, 40, 15, 1,
                   help="How many players to list at each end.")
st.caption("Click a player's name to open their full night.")
# Force the color-emoji font so 💩 renders brown (not a black monochrome glyph),
# with a brown color fallback for systems that still render it as text.
_EMOJI_FONT = ('"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif')
_angel = f"<span style='font-family:{_EMOJI_FONT}'>😇</span>"
_poo = f"<span style='font-family:{_EMOJI_FONT};color:#8B4513'>💩</span>"
st.markdown(f"### {_angel} Top positive surprises", unsafe_allow_html=True)
clickable_table(ranked.head(n_rows), "tbl_pos", pos_threshold, neg_threshold)
st.markdown(f"### {_poo} Top negative surprises", unsafe_allow_html=True)
clickable_table(ranked.tail(n_rows).iloc[::-1], "tbl_neg", pos_threshold, neg_threshold)

# --- Jump to any rank (under the current filter) ----------------------------
# Enter a start rank; the sub-table shows that rank through rank+19 (up to 20
# rows, fewer near the end). max_value auto-clamps an over-large entry.
st.subheader("🔎 Jump to a rank")
_total = len(ranked)
_WIN = 20
if _total:
    jc1, jc2 = st.columns(2)
    with jc1:
        g = st.number_input("Good — from rank #  (1 = best)", 1, _total, min(100, _total), 1,
                            key="jump_good")
        gw = ranked.iloc[g - 1: g - 1 + _WIN]                       # rank g … g+19, best-first
        st.caption(f"showing #{g:,}–#{g + len(gw) - 1:,} of {_total:,} (best → worst)")
        clickable_table(gw, "jump_g", pos_threshold, neg_threshold)
    with jc2:
        b = st.number_input("Bad — from rank #  (1 = worst)", 1, _total, min(100, _total), 1,
                            key="jump_bad")
        _end = _total - b                                           # position of bad-rank b
        bw = ranked.iloc[max(0, _end - _WIN + 1): _end + 1].iloc[::-1]   # worst-first
        st.caption(f"showing #{b:,}–#{b + len(bw) - 1:,} of {_total:,} (worst → best)")
        clickable_table(bw, "jump_b", pos_threshold, neg_threshold)

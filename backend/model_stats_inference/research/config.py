"""Configuration for the per-stat next-game prediction feature research.

Everything that is a knob — seasons, window sizes, recency caps, filter
thresholds, which stats we engineer features from, and which stats we predict —
lives here so the rest of the pipeline stays declarative.
"""

from __future__ import annotations

from pathlib import Path

# --- Data scope ------------------------------------------------------------

# Last 4 full seasons. NBA season string format is "YYYY-YY".
SEASONS: list[str] = ["2022-23", "2023-24", "2024-25", "2025-26"]

# Regular season only (excludes playoffs / play-in / preseason / all-star).
SEASON_TYPE = "Regular Season"

# --- Windows ---------------------------------------------------------------
# Each window is BOTH count-capped and recency-capped: take up to `games` most
# recent prior games, but drop any older than `days` before the target game.
WINDOWS: dict[str, dict[str, int]] = {
    "w10": {"games": 10, "days": 60},
    "w5": {"games": 5, "days": 30},
}

# --- Filters (the user stressed these matter) ------------------------------

# Drop a whole player if they have fewer than this many qualifying games.
MIN_PLAYER_GAMES = 20

# Remove games where the player barely played (DNP / garbage time). These rows
# are dropped ENTIRELY — not used as targets and not counted in any window/rate.
# Shared with serving: DBService.get_fs_rows_before gates feature-store reads
# on the same threshold, so training and the live store see the same population.
MIN_MINUTES = 5.0

# A row must have at least this many prior qualifying games to be a TRAINING
# target. Inference is supported at any depth; this only bounds what we train on.
MIN_HISTORY_GAMES = 1

# --- Stats -----------------------------------------------------------------

# Base per-game stats we engineer history features (mean/var/rate) from.
BASE_STATS: list[str] = [
    "PTS", "REB", "OREB", "DREB", "AST", "FG3M", "FG3A",
    "STL", "BLK", "TOV", "FGM", "FGA", "FTM", "FTA",
    "MIN", "PF", "PLUS_MINUS",
]

# Counting stats that get rate features: rate = sum(stat) / sum(MIN) over window.
# (Percentages and MIN/PLUS_MINUS are excluded — a per-minute rate is meaningless
# for them.)
RATE_STATS: list[str] = [
    "PTS", "REB", "OREB", "DREB", "AST", "FG3M", "FG3A",
    "STL", "BLK", "TOV", "FGM", "FGA", "FTM", "FTA",
]

# Targets we build models for. FG% / FT% are predicted via their components
# (FGM/FGA, FTM/FTA) and derived downstream, so they are not direct targets here.
TARGETS: list[str] = ["PTS", "REB", "AST", "FG3M", "STL", "BLK", "FGM", "FGA", "FTM", "FTA"]

# Opponent ("rival") stats-allowed features: how much the opponent team gives up.
# FGA/FTA/TOV joined with the 2026-07 FG improvement — the opponent's allowed
# shot volume, foul rate and forced turnovers (attempt-suppression defense).
# All three are columns fs_team_games already stores, so serving needs no
# schema change.
OPP_ALLOWED_STATS: list[str] = ["PTS", "REB", "AST", "STL", "BLK", "FG3M", "FG_PCT",
                                "FGA", "FTA", "TOV"]

# Own-team offensive context: the player's own team environment (pace, scoring).
TEAM_OWN_STATS: list[str] = ["PTS", "REB", "AST", "FG3M", "FG_PCT"]

# --- EWM block-history features (2026-07 BLK model improvement) -------------

# Exponentially-weighted history: reacts faster than the flat w5/w10 windows
# and never truncates. Halflives are in games; series are shifted one game
# before weighting so a game never leaks into its own features. Applied to the
# rare-event stats where the flat windows are noisiest (added with the 2026-07
# BLK improvement; STL joined with the same recipe).
EWM_STATS: list[str] = ["BLK", "STL", "REB", "AST", "PTS", "FGM", "FGA", "FTM", "FTA", "FG3M"]
EWM_HALFLIVES: list[int] = [5, 15]
# Halflife for the share-of-games indicator, and the per-stat threshold it
# counts: P(stat >= threshold). For rare events (blocks/steals) >=1 is the
# meaningful line; for volume stats the thresholds mark the board-crasher
# (>=6), playmaker (>=5), 20-point-scorer, hot-hand (>=8 makes),
# volume-shooter (>=15 attempts) and heavy-foul-drawer (>=6 FTA / >=5 FTM)
# lines instead.
EWM_SHARE_HALFLIFE = 10
EWM_SHARE_MIN: dict[str, int] = {
    "BLK": 1, "STL": 1, "REB": 6, "AST": 5, "PTS": 20, "FGM": 8, "FGA": 15,
    "FTM": 5, "FTA": 6, "FG3M": 4,
}

# Extra share thresholds (columns named {stat}_share{thr}_*): a coarse CDF of
# the stat's distribution. Useful where the distribution is bimodal — free
# throws split non-drawers from drawers, so P(>=2)/P(>=4) attempts and P(>=3)
# makes carry shape information the single primary threshold misses (2026-07
# FT tail improvement; the same idea tested as redundant for PTS).
EWM_SHARE_EXTRA: dict[str, list[int]] = {
    "FTA": [2, 4],
    "FTM": [3],
    "FG3M": [2, 3],
}

# Composite per-minute EWM rates (halflife EWM_COMPOSITE_HALFLIFE): each entry
# is name -> {column: weight}; the weighted sum is divided by MIN. Produces
# {name}_ewm{hl}_rate (the _rate suffix opts into the automatic T_x minutes
# interaction). BALLDOM — "who runs the offense" (AST work); FGA_LOAD —
# shot-creation volume; USAGE_LOAD — true possession usage (PTS work).
EWM_COMPOSITE_HALFLIFE = 10
EWM_RATE_COMPOSITES: dict[str, dict[str, float]] = {
    "BALLDOM": {"AST": 1.0, "TOV": 1.0},
    "FGA_LOAD": {"FGA": 1.0},
    "USAGE_LOAD": {"FGA": 1.0, "FTA": 0.44, "TOV": 1.0},
    # FG3A_LOAD — three-point attempt volume (2026-07 FG3M improvement).
    "FG3A_LOAD": {"FG3A": 1.0},
}

# Ratio composites: name -> (numerator weights, denominator weights), EWM of
# the per-game ratio (NaN when the denominator is 0 that game). Minutes-free,
# so no _rate suffix / no T_x. TS_EFF = PTS / (2*(FGA + 0.44*FTA)) — true
# shooting: "is he scoring efficiently lately".
EWM_RATIO_COMPOSITES: dict[str, tuple[dict[str, float], dict[str, float]]] = {
    "TS_EFF": ({"PTS": 1.0}, {"FGA": 2.0, "FTA": 0.88}),
    # FG_FORM — raw FG% form ("is he hot"); SHOT_DIET3 — 3PA share of the shot
    # mix (diet shifts move makes). Added with the 2026-07 FG improvement.
    "FG_FORM": ({"FGM": 1.0}, {"FGA": 1.0}),
    "SHOT_DIET3": ({"FG3A": 1.0}, {"FGA": 1.0}),
    # FT_FORM — free-throw % form. Added with the 2026-07 FT improvement.
    "FT_FORM": ({"FTM": 1.0}, {"FTA": 1.0}),
    # FG3_FORM — 3PT% form ("is his stroke on"). 2026-07 FG3M improvement.
    "FG3_FORM": ({"FG3M": 1.0}, {"FG3A": 1.0}),
}

# --- Player bio / anthro (2026-07 BLK model improvement) ---------------------

# Static per-player physical features, loaded from the frozen committed
# artifact (BIO_PATH). Wingspan/standing reach originate from NBA draft-combine
# measurements (no ESPN source, but they never change per player); height and
# weight for players missing from the artifact come from ESPN rosters.
# Missing values stay NaN — HGB handles them natively.
BIO_COLUMNS: list[str] = [
    "HEIGHT_IN", "WEIGHT_LB", "WINGSPAN_IN", "REACH_IN", "WING_MINUS_HEIGHT",
]

# --- Feature selection -----------------------------------------------------

N_SELECT = 50          # features to keep per target
CV_SPLITS = 5          # TimeSeriesSplit folds

# --- Paths -----------------------------------------------------------------

ROOT = Path(__file__).parent
DATA_DIR = ROOT / "data"
OUTPUT_DIR = ROOT / "outputs"

# Committed bio artifact — lives next to the model binaries because serving
# needs it on a fresh clone (research/data/ is gitignored).
BIO_PATH = ROOT.parent / "models" / "player_bio.parquet"

"""Configuration for the per-stat next-game prediction feature research.

Everything that is a knob — seasons, window sizes, recency caps, filter
thresholds, which stats we engineer features from, and which stats we predict —
lives here so the rest of the pipeline stays declarative.
"""

from __future__ import annotations

from pathlib import Path

# --- Data scope ------------------------------------------------------------

# Last 3 seasons. NBA season string format is "YYYY-YY".
SEASONS: list[str] = ["2023-24", "2024-25", "2025-26"]

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
MIN_MINUTES = 2.0

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
OPP_ALLOWED_STATS: list[str] = ["PTS", "REB", "AST", "STL", "BLK", "FG3M", "FG_PCT"]

# Own-team offensive context: the player's own team environment (pace, scoring).
TEAM_OWN_STATS: list[str] = ["PTS", "REB", "AST", "FG3M", "FG_PCT"]

# --- EWM block-history features (2026-07 BLK model improvement) -------------

# Exponentially-weighted history: reacts faster than the flat w5/w10 windows
# and never truncates. Halflives are in games; series are shifted one game
# before weighting so a game never leaks into its own features. Applied to the
# rare-event stats where the flat windows are noisiest (added with the 2026-07
# BLK improvement; STL joined with the same recipe).
EWM_STATS: list[str] = ["BLK", "STL", "REB"]
EWM_HALFLIVES: list[int] = [5, 15]
# Halflife for the share-of-games indicator, and the per-stat threshold it
# counts: P(stat >= threshold). For rare events (blocks/steals) >=1 is the
# meaningful line; for rebounds nearly every game has >=1, so >=6 separates
# real board-crashers instead.
EWM_SHARE_HALFLIFE = 10
EWM_SHARE_MIN: dict[str, int] = {"BLK": 1, "STL": 1, "REB": 6}

# --- Player bio / anthro (2026-07 BLK model improvement) ---------------------

# Static per-player physical features. Height/weight come from `playerindex`
# (full coverage); wingspan/standing reach from the draft combine (~65% of
# players — missing values stay NaN, HGB handles them natively).
BIO_COLUMNS: list[str] = [
    "HEIGHT_IN", "WEIGHT_LB", "WINGSPAN_IN", "REACH_IN", "WING_MINUS_HEIGHT",
]
COMBINE_YEARS = range(2000, 2026)

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

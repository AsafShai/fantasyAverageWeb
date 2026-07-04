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

# --- Feature selection -----------------------------------------------------

N_SELECT = 50          # features to keep per target
CV_SPLITS = 5          # TimeSeriesSplit folds

# --- Paths -----------------------------------------------------------------

ROOT = Path(__file__).parent
DATA_DIR = ROOT / "data"
OUTPUT_DIR = ROOT / "outputs"

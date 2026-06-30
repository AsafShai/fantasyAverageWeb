"""Explore the nba_api game-log datasets for the last 3 seasons.

Pulls league-wide PLAYER and TEAM game logs (one request per season each, so it
stays well under NBA.com rate limits) and prints everything you need to judge
whether this data is good enough to train on:

  - shape (rows x cols)
  - every column with its dtype
  - date range covered
  - null counts per column
  - a couple of sample rows (transposed so all columns are readable)

Optionally writes the raw data to parquet under ./data/ so you don't have to
re-download while iterating.

Run from the backend folder:
    uv run python model_stats_inference/explore_dataset.py
    uv run python model_stats_inference/explore_dataset.py --save
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path

import pandas as pd
from nba_api.stats.endpoints import playergamelogs, teamgamelogs

# Last 3 completed/in-progress seasons. NBA season string format is "YYYY-YY".
SEASONS = ["2023-24", "2024-25", "2025-26"]

# NBA.com is slow and occasionally throttles; give each request room and pause
# between calls to be polite.
REQUEST_TIMEOUT = 60
SLEEP_BETWEEN_CALLS = 1.0

DATA_DIR = Path(__file__).parent / "data"


def fetch_player_logs(seasons: list[str]) -> pd.DataFrame:
    """League-wide player game logs (one row per player per game)."""
    frames = []
    for season in seasons:
        print(f"  -> player logs {season} ...", flush=True)
        df = playergamelogs.PlayerGameLogs(
            season_nullable=season, timeout=REQUEST_TIMEOUT
        ).get_data_frames()[0]
        df.insert(0, "SEASON", season)
        frames.append(df)
        time.sleep(SLEEP_BETWEEN_CALLS)
    return pd.concat(frames, ignore_index=True)


def fetch_team_logs(seasons: list[str]) -> pd.DataFrame:
    """League-wide team game logs (one row per team per game)."""
    frames = []
    for season in seasons:
        print(f"  -> team logs {season} ...", flush=True)
        df = teamgamelogs.TeamGameLogs(
            season_nullable=season, timeout=REQUEST_TIMEOUT
        ).get_data_frames()[0]
        df.insert(0, "SEASON", season)
        frames.append(df)
        time.sleep(SLEEP_BETWEEN_CALLS)
    return pd.concat(frames, ignore_index=True)


def describe(name: str, df: pd.DataFrame) -> None:
    """Print a full profile of a dataframe."""
    print("\n" + "=" * 80)
    print(f"{name}")
    print("=" * 80)
    print(f"shape: {df.shape[0]:,} rows x {df.shape[1]} columns")
    print(f"memory: {df.memory_usage(deep=True).sum() / 1e6:.1f} MB")

    if "GAME_DATE" in df.columns:
        dates = pd.to_datetime(df["GAME_DATE"], errors="coerce")
        print(f"date range: {dates.min()}  ->  {dates.max()}")
        print(f"distinct games: {df['GAME_ID'].nunique():,}")
    if "SEASON" in df.columns:
        print("rows per season:")
        print(df["SEASON"].value_counts().sort_index().to_string())

    print("\ncolumns (name : dtype : non-null : nulls):")
    n = len(df)
    for col in df.columns:
        non_null = df[col].notna().sum()
        nulls = n - non_null
        print(f"  {col:<28} {str(df[col].dtype):<12} {non_null:>8,}  ({nulls:,} null)")

    print("\nsample rows (first 2, transposed):")
    with pd.option_context(
        "display.max_rows", None, "display.max_columns", None, "display.width", 200
    ):
        print(df.head(2).T.to_string())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--save", action="store_true", help="write raw data to ./data/*.parquet"
    )
    args = parser.parse_args()

    print(f"Fetching seasons: {', '.join(SEASONS)}")

    print("\nPlayer game logs:")
    players = fetch_player_logs(SEASONS)

    print("\nTeam game logs:")
    teams = fetch_team_logs(SEASONS)

    describe("PLAYER GAME LOGS", players)
    describe("TEAM GAME LOGS", teams)

    if args.save:
        DATA_DIR.mkdir(exist_ok=True)
        players.to_parquet(DATA_DIR / "player_game_logs.parquet", index=False)
        teams.to_parquet(DATA_DIR / "team_game_logs.parquet", index=False)
        print(f"\nSaved parquet files to {DATA_DIR}")


if __name__ == "__main__":
    main()

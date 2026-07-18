"""Explore the ESPN game-log datasets for the research seasons.

Loads the player and team game logs through the same fetch path the research
pipeline uses (month-cached under research/data/espn_cache, so re-runs are
free) and prints everything you need to judge the data:

  - shape (rows x cols)
  - every column with its dtype
  - date range covered
  - null counts per column
  - a couple of sample rows (transposed so all columns are readable)

Run from the backend folder:
    uv run python model_stats_inference/explore_dataset.py
"""

from __future__ import annotations

import pandas as pd

from model_stats_inference.research import config, data


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
    print(f"Fetching seasons from ESPN: {', '.join(config.SEASONS)}")
    players, teams = data.fetch_game_logs(config.SEASONS)

    describe("PLAYER GAME LOGS", players)
    describe("TEAM GAME LOGS", teams)


if __name__ == "__main__":
    main()

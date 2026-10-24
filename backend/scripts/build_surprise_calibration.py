"""Build serving/surprise_calibration.json from a walk-forward research parquet.

The surprise scores on the "Last Night" tab are standardized against one
reference season so a night's numbers mean the same thing in November and in
April. Re-run this after each season's walk-forward backtest
(model_stats_inference.research.backtest_walkforward) to refresh the reference:

    cd backend
    uv run python scripts/build_surprise_calibration.py \
        [--parquet model_stats_inference/research/data/walkforward_2025_26.parquet]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from model_stats_inference.serving import surprise  # noqa: E402

DEFAULT_PARQUET = (
    Path(__file__).resolve().parents[1]
    / "model_stats_inference" / "research" / "data" / "walkforward_2025_26.parquet"
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--parquet", type=Path, default=DEFAULT_PARQUET)
    parser.add_argument("--out", type=Path, default=surprise.CALIBRATION_PATH)
    args = parser.parse_args()

    # Recomputed even when the parquet carries it, so it always counts the same way.
    df = surprise.add_season_games(pd.read_parquet(args.parquet))
    missing = [c for c in surprise.required_columns() if c not in df.columns]
    if missing:
        sys.exit(f"parquet lacks the research columns {missing}; re-run the backtest")

    calibration = surprise.build_calibration(df, source=args.parquet.name)
    args.out.write_text(json.dumps(calibration, indent=1))

    scored = surprise.score_frame(df, calibration)
    print(f"{len(df):,} player-games, {calibration['final_count']:,} scored -> {args.out}")
    print(f"SCORE mean {scored['SCORE'].mean():.3f} std {scored['SCORE'].std():.3f}")
    view = df[["PLAYER_NAME", "GAME_DATE", "MIN", "PTS", "REB", "AST"]].join(scored["SCORE"])
    print("top 5:")
    print(view.nlargest(5, "SCORE").to_string(index=False))
    print("bottom 5:")
    print(view.nsmallest(5, "SCORE").to_string(index=False))


if __name__ == "__main__":
    main()

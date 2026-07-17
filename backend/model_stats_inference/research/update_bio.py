"""Refresh the frozen player-bio artifact from current ESPN rosters.

Run once a season (e.g. after rosters settle in October):

    uv run python -m model_stats_inference.research.update_bio
        -> adds rookies / newly rostered players (height+weight, combine NaN)

    uv run python -m model_stats_inference.research.update_bio --update-existing
        -> also refreshes height/weight of players already in the artifact

Combine measurements (wingspan/reach) are frozen historical data with no live
source; this script never modifies them. Commit the rewritten parquet
(model_stats_inference/models/player_bio.parquet) afterwards.
"""

from __future__ import annotations

import argparse

from . import data


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--update-existing",
        action="store_true",
        help="also overwrite height/weight of players already in the artifact",
    )
    args = parser.parse_args()
    bio = data.refresh_bio_from_rosters(update_existing=args.update_existing)
    n_wing = int(bio["WINGSPAN_IN"].notna().sum())
    print(f"Artifact now covers {len(bio):,} players ({n_wing:,} with combine wingspan)")


if __name__ == "__main__":
    main()

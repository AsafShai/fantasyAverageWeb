"""Pre-record the bulk game history (scoreboards + box-score summaries) that the
model bootstrap pulls, through the app's own ESPN client, so the request keys
on tape are exactly the ones the bootstrap makes on replay.

    PYTHONPATH=. uv run python -m golden.record_games --tape golden/_data/tape

Idempotent: requests already on tape are not refetched.
"""

from __future__ import annotations

import argparse
import logging
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from golden.tape import Tape


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tape", default="golden/_data/tape")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

    tape = Tape(Path(args.tape), "record")
    tape.install()

    from model_stats_inference.espn import client, games
    from model_stats_inference.research import config as rconfig

    months = [m for s in rconfig.SEASONS for m in games.season_months(s)]
    event_ids: list[str] = []
    for m in months:
        sb = client.scoreboard(m)
        evs = [e for e in sb.get("events", []) if games.is_countable(e) and games.is_final(e)]
        event_ids += [str(e["id"]) for e in evs]
        logging.info(f"{m}: {len(evs)} countable final games")

    done = 0

    def one(eid: str) -> None:
        nonlocal done
        client.game_summary(eid)
        done += 1
        if done % 100 == 0:
            logging.info(f"summaries: {done}/{len(event_ids)}")

    with ThreadPoolExecutor(args.workers) as pool:
        list(pool.map(one, event_ids))
    logging.info(f"done: {len(event_ids)} summaries, {len(tape.requests)} requests")


if __name__ == "__main__":
    main()

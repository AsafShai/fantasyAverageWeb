"""Memory of the background work that runs all day in the web process.

The request-path soak (bench_soak.py) stays flat: requests mostly run on the
event-loop thread. What runs in worker threads, and so spreads its garbage
over several glibc malloc arenas, is the injury-report parse (every 15 min)
and the model predictions (every matchups rebuild and every slider move on
the projections page). This replays a day of both, overlapped the way they
overlap in production, and samples RSS.

Usage (from backend/, after the model store is seeded):
    python scripts/bench_background_jobs.py --cycles 96 --pdf report.pdf [--trim]
    MALLOC_ARENA_MAX=2 python scripts/bench_background_jobs.py ...
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import injury_service  # noqa: E402
from app.services.db_service import DBService  # noqa: E402
from app.services.model_nightly_service import ModelNightlyService  # noqa: E402
from model_stats_inference.serving.inference import LiveInference, PredictionRequest  # noqa: E402


def _rss_mb() -> float:
    for line in Path("/proc/self/status").read_text().splitlines():
        if line.startswith("VmRSS:"):
            return round(int(line.split()[1]) / 1024, 1)
    return -1.0


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cycles", type=int, default=96, help="injury cycles (96 = one day)")
    ap.add_argument("--predict-batches", type=int, default=3, help="prediction batches per cycle")
    ap.add_argument("--pdf", required=True)
    ap.add_argument("--trim", action="store_true", help="use the parse-then-trim path")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    pdf = Path(args.pdf).read_bytes()
    store = await ModelNightlyService().get_inference_store()
    if store is None:
        raise SystemExit("model store is empty; seed it first")
    inference = await asyncio.to_thread(LiveInference, store)
    players = store.player_vectors["PLAYER_ID"].tolist()[:270]
    teams = store.team_allowed_vectors["TEAM_ID"].tolist()
    today = pd.Timestamp.now().normalize()
    reqs = [
        PredictionRequest(int(p), int(teams[i % len(teams)]), bool(i % 2), today, 30.0)
        for i, p in enumerate(players)
    ]
    parse = injury_service._parse_and_trim if args.trim else injury_service.parse_injury_pdf

    samples = [{"cycle": 0, "rss_mb": _rss_mb()}]
    t0 = time.perf_counter()
    for cycle in range(1, args.cycles + 1):
        jobs = [asyncio.to_thread(parse, pdf)]
        jobs += [asyncio.to_thread(inference.predict_many, reqs) for _ in range(args.predict_batches)]
        await asyncio.gather(*jobs)
        if cycle % 8 == 0 or cycle == args.cycles:
            samples.append({"cycle": cycle, "rss_mb": _rss_mb()})
            print(samples[-1], flush=True)
    result = {
        "trim": args.trim,
        "start_rss_mb": samples[0]["rss_mb"],
        "end_rss_mb": samples[-1]["rss_mb"],
        "max_rss_mb": max(s["rss_mb"] for s in samples),
        "seconds": round(time.perf_counter() - t0, 1),
        "samples": samples,
    }
    print(json.dumps({k: v for k, v in result.items() if k != "samples"}))
    if args.out:
        Path(args.out).write_text(json.dumps(result, indent=2))
    await DBService().close()


if __name__ == "__main__":
    asyncio.run(main())

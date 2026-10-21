"""Memory soak test: does the web process's RSS keep climbing under traffic?

Production RSS creeps from ~340 MB to ~480 MB over a day without any single
spike. This replays a day's worth of cache-missing work in minutes: every
request asks for something the server has not cached (a new custom date
window, another slate date, another team), so each one rebuilds frames,
Pydantic models and JSON in worker threads the way expired caches do in prod.

Usage (from backend/):
    python scripts/bench_soak.py --minutes 10 --out soak.json [--cgroup bench] [--env MALLOC_ARENA_MAX=2]
"""

from __future__ import annotations

import argparse
import itertools
import threading
from concurrent.futures import ThreadPoolExecutor
import json
import os
import random
import signal
import subprocess
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bench_api import _cg, _cg_reset_peak, _mb, _rss, _start_server, _wait_ready  # noqa: E402


def _paths(season_start: date, today: date):
    rnd = random.Random(0)
    span = max((today - season_start).days, 2)
    teams = itertools.cycle(range(1, 13))
    periods = itertools.cycle(["season", "last_7", "last_15", "last_30"])
    day = 0
    while True:
        a = season_start + timedelta(days=rnd.randrange(0, span - 1))
        b = min(a + timedelta(days=rnd.randrange(1, 30)), today)
        if b <= a:
            b = a + timedelta(days=1)
        yield f"/api/players/?page=1&limit=1200&time_period=custom&start={a}&end={b}"
        yield f"/api/teams/{next(teams)}?time_period={next(periods)}"
        d = today + timedelta(days=day % 14)
        day += 1
        yield f"/api/matchups/today?date={d:%Y%m%d}"
        yield "/api/players/?page=1&limit=1200&time_period=season"
        yield "/api/nba/schedule"
        yield "/api/league/summary"
        yield "/api/league/today"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=float, default=10)
    ap.add_argument("--port", type=int, default=8766)
    ap.add_argument("--cgroup", default=None)
    ap.add_argument("--sample-every", type=float, default=30)
    ap.add_argument("--season-start", default="2026-10-20")
    ap.add_argument("--out", default=None)
    ap.add_argument("--env", action="append", default=[])
    ap.add_argument("--concurrency", type=int, default=6,
                    help="parallel clients; prod sees overlapping page loads, which is what fans "
                         "work out over many worker threads (and malloc arenas)")
    args = ap.parse_args()

    env_extra = dict(kv.split("=", 1) for kv in args.env)
    _cg_reset_peak(args.cgroup)
    proc = _start_server(args.port, args.cgroup, env_extra)
    client = httpx.Client(base_url=f"http://127.0.0.1:{args.port}", timeout=180, follow_redirects=True)
    samples = []
    try:
        _wait_ready(client, proc)
        time.sleep(20)
        t0 = time.perf_counter()
        paths = _paths(date.fromisoformat(args.season_start), date.today())
        lock = threading.Lock()
        counts = {"requests": 0, "errors": 0}
        deadline = t0 + args.minutes * 60

        def worker() -> None:
            with httpx.Client(base_url=f"http://127.0.0.1:{args.port}", timeout=180, follow_redirects=True) as c:
                while time.perf_counter() < deadline:
                    with lock:
                        path = next(paths)
                    try:
                        bad = c.get(path).status_code >= 500
                    except httpx.HTTPError:
                        bad = True
                    with lock:
                        counts["requests"] += 1
                        counts["errors"] += bad

        with ThreadPoolExecutor(args.concurrency) as pool:
            for _ in range(args.concurrency):
                pool.submit(worker)
            while (elapsed := time.perf_counter() - t0) < args.minutes * 60:
                samples.append({
                    "t_s": round(elapsed),
                    "requests": counts["requests"],
                    "rss_mb": _mb(_rss(proc.pid)),
                    "container_mb": _mb(_cg(args.cgroup, "memory.usage_in_bytes")),
                })
                print(samples[-1], flush=True)
                time.sleep(args.sample_every)
        requests, errors = counts["requests"], counts["errors"]
        samples.append({
            "t_s": round(time.perf_counter() - t0), "requests": requests,
            "rss_mb": _mb(_rss(proc.pid)), "container_mb": _mb(_cg(args.cgroup, "memory.usage_in_bytes")),
        })
        result = {
            "env": env_extra,
            "samples": samples,
            "requests": requests,
            "errors": errors,
            "start_rss_mb": samples[0]["rss_mb"],
            "end_rss_mb": samples[-1]["rss_mb"],
            "max_rss_mb": max(s["rss_mb"] for s in samples if s["rss_mb"] is not None),
            "peak_container_mb": _mb(_cg(args.cgroup, "memory.max_usage_in_bytes")),
        }
        print(json.dumps({k: v for k, v in result.items() if k != "samples"}, indent=2))
        if args.out:
            Path(args.out).write_text(json.dumps(result, indent=2))
    finally:
        client.close()
        proc.send_signal(signal.SIGINT)
        try:
            proc.wait(timeout=20)
        except subprocess.TimeoutExpired:
            proc.kill()


if __name__ == "__main__":
    main()

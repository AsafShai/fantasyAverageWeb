"""Benchmarks on the golden inputs: the same DB, tape and clock for both sides.

    # once: build the DB snapshots (any side; the two sides' DBs are identical)
    PYTHONPATH=. python -m golden.bench seed --snapdir /tmp/golden-snaps
    # the API on the full snapshot, for scripts/bench_api.py / bench_soak.py
    PYTHONPATH=. python -m golden.bench serve --snapshot /tmp/golden-snaps/full
    # one background job in a fresh process: wall, CPU and peak RSS as JSON
    PYTHONPATH=. python -m golden.bench job --phase nightly --snapshot /tmp/golden-snaps/post_bootstrap

Snapshots: ``post_bootstrap`` is the DB right after the model bootstrap (the
nightly catch-up of 2026-11-17..19 and the surprises backfill still to run);
``full`` is the DB after every job of ``golden.run``. ``serve`` replays the
tape with the clock starting at T0 and ticking; ``job`` freezes it at T0 like
``golden.run``.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import resource
import runpy
import shutil
import sys
import tempfile
import time
from datetime import timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent
sys.path.insert(0, str(BACKEND))

from golden.run import BOOTSTRAP_UNTIL, T0, _env  # noqa: E402  (stdlib-only module scope)

log = logging.getLogger("golden.bench")


def _install(tape_dir: str, tick: bool, seasons: str | None = None):
    """Tape replay, pinned estimator RNG, the clock at T0 (ticking or frozen),
    no ESPN backoff sleeps, a fresh cache dir. Imports only what the app
    imports anyway (numpy, the ESPN client, the research config)."""
    import numpy as np
    import time_machine

    from golden.tape import Tape
    from model_stats_inference.espn import client as espn_client
    from model_stats_inference.research import config as rconfig

    tape = Tape(Path(tape_dir), "replay")
    tape.install()
    orig_rng = np.random.default_rng
    np.random.default_rng = lambda seed=None, *a, **k: orig_rng(12345 if seed is None else seed, *a, **k)
    time_machine.travel(T0, tick=tick).start()
    espn_client.SLEEP_BETWEEN_CALLS = 0.0
    espn_client.RETRY_DELAYS = []
    if seasons:
        rconfig.SEASONS = seasons.split(",")
    rconfig.DATA_DIR = Path(tempfile.mkdtemp(prefix="golden-espn-"))
    return tape


def _status_kb(field: str) -> int:
    for line in Path("/proc/self/status").read_text().splitlines():
        if line.startswith(field + ":"):
            return int(line.split()[1])
    return -1


def _reset_peak() -> None:
    # Linux: writing 5 to clear_refs resets VmHWM to the current RSS.
    Path("/proc/self/clear_refs").write_text("5")


def _cpu_s() -> float:
    ru = resource.getrusage(resource.RUSAGE_SELF)
    return ru.ru_utime + ru.ru_stime


def _snapdir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    if os.geteuid() == 0:
        shutil.chown(path, "postgres", "postgres")
    return path


# --- seed ------------------------------------------------------------------

async def _seed(args) -> None:
    from golden.pg import LocalPostgres
    from golden.run import run_jobs

    snapdir = _snapdir(Path(args.snapdir))
    pg = LocalPostgres(port=args.pg_port).start()
    _env(pg.url)
    _install(args.tape, tick=False, seasons=args.seasons)
    try:
        from app.services.model_nightly_service import ModelNightlyService
        import golden.run as grun

        # run_jobs in order, with a snapshot right after the bootstrap.
        orig_bootstrap = ModelNightlyService.bootstrap

        async def bootstrap_then_snapshot(self, *a, **k):
            res = await orig_bootstrap(self, *a, **k)
            from app.services.db_service import DBService
            await DBService().close()
            pg.snapshot(snapdir / "post_bootstrap")
            return res

        ModelNightlyService.bootstrap = bootstrap_then_snapshot
        out = Path(tempfile.mkdtemp(prefix="golden-seed-"))
        await grun.run_jobs(out, pg.url)
        from app.services.db_service import DBService
        await DBService().close()
        pg.snapshot(snapdir / "full")
        print("snapshots in", snapdir)
    finally:
        pg.stop()


# --- serve -----------------------------------------------------------------

def _serve(args) -> None:
    from golden.pg import LocalPostgres

    pg = LocalPostgres(port=args.pg_port).start(snapshot=Path(args.snapshot))
    try:
        port = os.environ.get("PORT")
        _env(pg.url)
        if port:
            os.environ["PORT"] = port
        _install(args.tape, tick=True)
        sys.argv = ["app.main"]
        runpy.run_module("app.main", run_name="__main__", alter_sys=True)
    finally:
        pg.stop()


# --- job -------------------------------------------------------------------

async def _job(args) -> None:
    from golden.pg import LocalPostgres

    pg = LocalPostgres(port=args.pg_port).start(snapshot=Path(args.snapshot) if args.snapshot else None)
    try:
        _env(pg.url)
        _install(args.tape, tick=False, seasons=args.seasons)
        from app.services.db_service import DBService
        from app.services.model_nightly_service import ModelNightlyService
        from app.services.surprise_service import SurpriseService

        phases = {
            "bootstrap": lambda: ModelNightlyService().bootstrap(until_date=BOOTSTRAP_UNTIL),
            "nightly": lambda: ModelNightlyService().run_catchup(through=(T0 - timedelta(days=1)).date()),
            "surprises_backfill": lambda: SurpriseService().backfill_missing(),
        }
        result: dict = {"phase": args.phase, "rss_after_imports_mb": round(_status_kb("VmRSS") / 1024, 1)}
        steps = ["nightly", "surprises_backfill"] if args.phase == "nightly" else [args.phase]
        for name in steps:
            _reset_peak()
            rss0, cpu0, t0 = _status_kb("VmRSS"), _cpu_s(), time.perf_counter()
            res = await phases[name]()
            result[name] = {
                "wall_s": round(time.perf_counter() - t0, 2),
                "cpu_s": round(_cpu_s() - cpu0, 2),
                "rss_start_mb": round(rss0 / 1024, 1),
                "rss_end_mb": round(_status_kb("VmRSS") / 1024, 1),
                "peak_rss_mb": round(_status_kb("VmHWM") / 1024, 1),
                "result": str(res)[:200],
            }
        result["process_peak_rss_mb"] = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1)
        await DBService().close()
        line = json.dumps(result)
        print(line)
        if args.out:
            Path(args.out).write_text(line)
    finally:
        pg.stop()


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("seed", "serve", "job"):
        p = sub.add_parser(name)
        p.add_argument("--tape", default=str(HERE / "_data" / "tape"))
        p.add_argument("--pg-port", type=int, default=55460)
        p.add_argument("--seasons", default="2022-23,2023-24,2024-25,2025-26,2026-27")
        if name == "seed":
            p.add_argument("--snapdir", required=True)
        if name in ("serve", "job"):
            p.add_argument("--snapshot", default=None, required=name == "serve")
        if name == "job":
            p.add_argument("--phase", choices=["bootstrap", "nightly", "surprises_backfill"], required=True)
            p.add_argument("--out", default=None)
    args = ap.parse_args()
    logging.basicConfig(level=logging.WARNING, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    if args.cmd == "seed":
        asyncio.run(_seed(args))
    elif args.cmd == "serve":
        _serve(args)
    else:
        asyncio.run(_job(args))


if __name__ == "__main__":
    main()

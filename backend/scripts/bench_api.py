"""Before/after benchmark for the web process: memory and endpoint latency.

Starts the API in a fresh process (optionally inside a cgroup that mimics the
Render free instance: 0.15 CPU, 512 MiB), waits for startup, then replays the
requests a page load makes. For each run it records:

  * startup RSS and container memory
  * "uncached" latency: the first hit of each endpoint after a fresh start
  * "cached" latency: the median of the next N hits (inside the server TTLs)
  * RSS after every round, so growth across rounds is visible
  * peak container memory for the whole run

Usage (from backend/, with DATABASE_URL/SEASON_ID/LEAGUE_ID in .env):
    python scripts/bench_api.py --runs 3 --rounds 5 --label before --out bench_before.json
    python scripts/bench_api.py --cgroup bench ...   # run inside /sys/fs/cgroup/{cpu,memory}/bench
    python scripts/bench_api.py --docker fantasy-backend:latest ...   # the real image, --cpus 0.15 -m 512m

Compare two result files:
    python scripts/bench_api.py --compare bench_before.json bench_after.json
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import statistics
import subprocess
import sys
import time
from pathlib import Path

import httpx

BACKEND = Path(__file__).resolve().parents[1]

# What a visitor's page loads hit, taken from the production access log.
ENDPOINTS = [
    "/api/nba-teams/",
    "/api/teams/",
    "/api/rankings?order=asc",
    "/api/league/summary",
    "/api/players/?page=1&limit=1200&time_period=season",
    "/api/estimator/results",
    "/api/league/today",
    "/api/league/activity/latest?limit=8",
    "/api/matchups/current-slate-date",
    "/api/matchups/upcoming-dates",
    "/api/matchups/today",
    "/api/teams/8?time_period=season",
    "/api/teams/1?time_period=season",
    "/api/analytics/heatmap",
    "/api/nba/schedule",
    "/api/league/activity",
    "/api/injuries/",
    "/api/league/shots",
    "/api/players/?page=1&limit=1200&time_period=last_7",
    "/api/trends/minutes?window_days=15",
]


def _rss(pid: int) -> int | None:
    try:
        for line in Path(f"/proc/{pid}/status").read_text().splitlines():
            if line.startswith("VmRSS:"):
                return int(line.split()[1]) * 1024
    except OSError:
        return None
    return None


def _cg(cgroup: str | None, name: str) -> int | None:
    if not cgroup:
        return None
    try:
        return int(Path(f"/sys/fs/cgroup/memory/{cgroup}/{name}").read_text())
    except OSError:
        return None


def _cg_stat(cgroup: str | None, key: str) -> int | None:
    if not cgroup:
        return None
    try:
        for line in Path(f"/sys/fs/cgroup/memory/{cgroup}/memory.stat").read_text().splitlines():
            k, v = line.split()
            if k == key:
                return int(v)
    except OSError:
        return None
    return None


def _cg_working_set(cgroup: str | None) -> int | None:
    """usage - inactive file cache: the "working set" container platforms
    (cAdvisor, so most dashboards) chart and evict on."""
    usage = _cg(cgroup, "memory.usage_in_bytes")
    inactive = _cg_stat(cgroup, "total_inactive_file")
    return None if usage is None or inactive is None else usage - inactive


def _cg_reset_peak(cgroup: str | None) -> None:
    if cgroup:
        try:
            Path(f"/sys/fs/cgroup/memory/{cgroup}/memory.max_usage_in_bytes").write_text("0")
        except OSError:
            pass


def _mb(n: int | None) -> float | None:
    return None if n is None else round(n / 1048576, 1)


def _start_server(port: int, cgroup: str | None, env_extra: dict[str, str]) -> subprocess.Popen:
    env = {**os.environ, "PORT": str(port), "LOG_LEVEL": "WARNING", **env_extra}
    cmd = [sys.executable, "-m", "app.main"]
    if cgroup:
        # Join the cgroup before exec so every byte the server allocates counts.
        cmd = [
            "sh", "-c",
            f"echo $$ > /sys/fs/cgroup/cpu/{cgroup}/tasks && "
            f"echo $$ > /sys/fs/cgroup/memory/{cgroup}/tasks && exec \"$@\"",
            "sh", *cmd,
        ]
    return subprocess.Popen(cmd, cwd=BACKEND, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def _wait_ready(client: httpx.Client, proc: subprocess.Popen, timeout: float = 180) -> float:
    t0 = time.perf_counter()
    while time.perf_counter() - t0 < timeout:
        if proc.poll() is not None:
            raise RuntimeError(f"server exited: {proc.stderr.read().decode()[-2000:]}")
        try:
            if client.get("/health").status_code == 200:
                return time.perf_counter() - t0
        except httpx.HTTPError:
            pass
        time.sleep(0.2)
    raise TimeoutError("server did not become ready")


def _hit(client: httpx.Client, path: str) -> tuple[float, int, int]:
    t0 = time.perf_counter()
    r = client.get(path)
    return (time.perf_counter() - t0) * 1000, r.status_code, len(r.content)


def _start_docker(image: str, port: int, env_extra: dict[str, str]) -> tuple[subprocess.Popen, str]:
    """Run the image the way Render's free instance does (0.15 CPU, 512 MiB).
    Returns the `docker run` process and the container's memory cgroup."""
    name = f"bench-{port}-{int(time.time())}"
    env = {"PORT": str(port), "LOG_LEVEL": "WARNING", **env_extra}
    cmd = ["docker", "run", "--rm", "--name", name, "--cpus", "0.15", "-m", "512m",
           "--network", "host", "--env-file", str(BACKEND / ".env")]
    for k, v in env.items():
        cmd += ["-e", f"{k}={v}"]
    proc = subprocess.Popen([*cmd, image], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"docker run exited: {proc.stderr.read().decode()[-2000:]}")
        out = subprocess.run(["docker", "inspect", "-f", "{{.Id}}", name], capture_output=True, text=True)
        if out.returncode == 0 and out.stdout.strip():
            return proc, f"docker/{out.stdout.strip()}"
        time.sleep(0.2)
    raise RuntimeError("container did not start")


def one_run(port: int, rounds: int, cgroup: str | None, settle: float, env_extra: dict[str, str],
            docker_image: str | None = None) -> dict:
    if docker_image:
        proc, cgroup = _start_docker(docker_image, port, env_extra)
    else:
        _cg_reset_peak(cgroup)
        proc = _start_server(port, cgroup, env_extra)
    client = httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=180, follow_redirects=True)

    def mem() -> int | None:
        # A container's whole cgroup is what the OOM killer counts (every
        # process in it, plus page cache), so report that for --docker runs.
        return _cg_working_set(cgroup) if docker_image else _rss(proc.pid)

    try:
        ready_s = _wait_ready(client, proc)
        time.sleep(settle)  # let the startup warmers (league activity, injuries) finish
        result: dict = {
            "ready_s": round(ready_s, 2),
            "startup_rss_mb": _mb(mem()),
            "startup_container_mb": _mb(_cg(cgroup, "memory.usage_in_bytes")),
            "startup_anon_rss_mb": _mb(_cg_stat(cgroup, "total_rss")),
            "uncached_ms": {},
            "cached_ms": {},
            "status": {},
            "bytes": {},
            "rss_after_round_mb": [],
        }
        cached: dict[str, list[float]] = {p: [] for p in ENDPOINTS}
        for rnd in range(rounds):
            for path in ENDPOINTS:
                ms, status, size = _hit(client, path)
                if rnd == 0:
                    result["uncached_ms"][path] = round(ms, 1)
                    result["status"][path] = status
                    result["bytes"][path] = size
                else:
                    cached[path].append(ms)
            result["rss_after_round_mb"].append(_mb(mem()))
        result["cached_ms"] = {p: round(statistics.median(v), 1) for p, v in cached.items() if v}
        result["uncached_total_ms"] = round(sum(result["uncached_ms"].values()), 1)
        result["cached_total_ms"] = round(sum(result["cached_ms"].values()), 1)
        result["final_rss_mb"] = _mb(mem())
        result["final_container_mb"] = _mb(_cg(cgroup, "memory.usage_in_bytes"))
        result["final_anon_rss_mb"] = _mb(_cg_stat(cgroup, "total_rss"))
        result["peak_container_mb"] = _mb(_cg(cgroup, "memory.max_usage_in_bytes"))
        return result
    finally:
        client.close()
        if docker_image:
            subprocess.run(["docker", "stop", "-t", "10", cgroup.split("/")[1]], capture_output=True)
        proc.send_signal(signal.SIGINT)
        try:
            proc.wait(timeout=20)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()


def _summary(runs: list[dict]) -> dict:
    def med(key: str):
        vals = [r[key] for r in runs if r.get(key) is not None]
        return round(statistics.median(vals), 1) if vals else None

    per_endpoint = {}
    for path in ENDPOINTS:
        u = [r["uncached_ms"].get(path) for r in runs if path in r["uncached_ms"]]
        c = [r["cached_ms"].get(path) for r in runs if path in r["cached_ms"]]
        per_endpoint[path] = {
            "uncached_median_ms": round(statistics.median(u), 1) if u else None,
            "cached_median_ms": round(statistics.median(c), 1) if c else None,
        }
    return {
        "runs": len(runs),
        "ready_s": med("ready_s"),
        "startup_rss_mb": med("startup_rss_mb"),
        "final_rss_mb": med("final_rss_mb"),
        "peak_container_mb": med("peak_container_mb"),
        "uncached_total_ms": med("uncached_total_ms"),
        "cached_total_ms": med("cached_total_ms"),
        "endpoints": per_endpoint,
    }


def _load_runs(spec: str) -> list[dict]:
    """A results file, or several joined with commas (one run per file is how
    the interleaved before/after scripts write them)."""
    runs: list[dict] = []
    for path in spec.split(","):
        runs += json.loads(Path(path).read_text())["runs"]
    return runs


def compare(before_spec: str, after_spec: str) -> None:
    b_runs, a_runs = _load_runs(before_spec), _load_runs(after_spec)
    b, a = _summary(b_runs), _summary(a_runs)

    def spread(runs, key):
        vals = [r[key] for r in runs if r.get(key) is not None]
        return f"{min(vals):g}–{max(vals):g}" if vals else ""

    print(f"Medians of {len(b_runs)} before / {len(a_runs)} after runs; ranges in brackets.\n")
    print("| metric | before | after | change |\n|---|---|---|---|")
    for key in ("ready_s", "startup_rss_mb", "final_rss_mb", "peak_container_mb", "uncached_total_ms", "cached_total_ms"):
        bv, av = b.get(key), a.get(key)
        if bv is None or av is None:
            print(f"| {key} | {bv} | {av} | |")
            continue
        pct = ((av - bv) / bv * 100) if bv else 0
        print(f"| {key} | {bv} [{spread(b_runs, key)}] | {av} [{spread(a_runs, key)}] | {av - bv:+.1f} ({pct:+.0f}%) |")
    print("\n| endpoint | uncached before | uncached after | cached before | cached after |\n|---|---|---|---|---|")
    for path in ENDPOINTS:
        be, ae = b["endpoints"].get(path, {}), a["endpoints"].get(path, {})
        print(
            f"| `{path}` | {be.get('uncached_median_ms')} | {ae.get('uncached_median_ms')} "
            f"| {be.get('cached_median_ms')} | {ae.get('cached_median_ms')} |"
        )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--rounds", type=int, default=5)
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--cgroup", default=None)
    ap.add_argument("--settle", type=float, default=20.0)
    ap.add_argument("--label", default="run")
    ap.add_argument("--out", default=None)
    ap.add_argument("--env", action="append", default=[], help="KEY=VALUE passed to the server")
    ap.add_argument("--docker", default=None, help="benchmark this image instead of the local venv")
    ap.add_argument("--compare", nargs=2, metavar=("BEFORE", "AFTER"))
    args = ap.parse_args()

    if args.compare:
        compare(*args.compare)
        return

    env_extra = dict(kv.split("=", 1) for kv in args.env)
    runs = []
    for i in range(args.runs):
        res = one_run(args.port, args.rounds, args.cgroup, args.settle, env_extra, args.docker)
        runs.append(res)
        print(
            f"[{args.label}] run {i + 1}/{args.runs}: startup_rss={res['startup_rss_mb']}MB "
            f"final_rss={res['final_rss_mb']}MB peak={res['peak_container_mb']}MB "
            f"uncached_total={res['uncached_total_ms']}ms cached_total={res['cached_total_ms']}ms",
            flush=True,
        )
    out = {"label": args.label, "runs": runs, "summary": _summary(runs)}
    if args.out:
        Path(args.out).write_text(json.dumps(out, indent=2))
    print(json.dumps(out["summary"], indent=2))


if __name__ == "__main__":
    main()

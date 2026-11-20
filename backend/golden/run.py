"""Golden-master run: the whole backend on fixed, recorded inputs.

One run = a fresh local Postgres, time frozen at T0, every HTTP request served
from the tape (golden/tape.py), then:

  1. the background jobs, in production order, writing to the DB:
     NBA player catalog refresh, injury report, model bootstrap + nightly
     catch-up (feature store fold, eval rows, surprises scoring), roster
     stints, standings DB sync, estimator, league activity, ADP refresh +
     snapshot;
  2. every API endpoint the frontend calls, with the query-param variants it
     uses, twice (first hit, then the cached hit);
  3. the model path directly: stored feature vectors and predictions for every
     player in the store (floats as exact hex);
  4. a dump of every DB table (volatile *_at columns dropped).

Everything lands in --out as JSON; golden/compare.py diffs two runs.

    # once, with network: fill the tape (record mode passes misses through)
    PYTHONPATH=. uv run --with time-machine python -m golden.run --mode record --out /tmp/rec
    # before / after
    PYTHONPATH=. uv run --with time-machine python -m golden.run --out golden/_data/before
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import math
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent
sys.path.insert(0, str(BACKEND))

# Frozen "now": Friday 2026-11-20 12:00 UTC (07:00 ET) — last night's games are
# final, ESPN has rolled the scoring period, tonight's slate is upcoming.
T0 = datetime(2026, 11, 20, 12, 0, 0, tzinfo=timezone.utc)
LEAGUE_ID = 660330196
SEASON_ID = 2027
# Bootstrap the store through this date; the nightly catch-up then folds the
# last nights in one at a time (the incremental production path).
BOOTSTRAP_UNTIL = date(2026, 11, 16)

log = logging.getLogger("golden")


def _env(db_url: str) -> None:
    os.environ.update({
        "SEASON_ID": str(SEASON_ID),
        "LEAGUE_ID": str(LEAGUE_ID),
        "DATABASE_URL": db_url,
        "ENVIRONMENT": "golden",
        "LOG_LEVEL": os.environ.get("GOLDEN_LOG_LEVEL", "WARNING"),
        "INJURY_SCHEDULER_ENABLED": "false",
        "MODEL_NIGHTLY_ENABLED": "false",
        "NBA_PLAYERS_REFRESH_ENABLED": "false",
        "ADP_SCHEDULER_ENABLED": "false",
        "LEAGUE_ACTIVITY_WARM": "false",
        "LIVE_STANDINGS_ENABLED": "false",
        "MODEL_FEATURE_HEAL_AUTO": "false",
        "TRENDS_MIN_SEASON_GP": "5",
    })


# --- JSON helpers -----------------------------------------------------------

def _jsonable(v):
    if isinstance(v, float):
        if math.isnan(v):
            return {"$float": "nan"}
        if math.isinf(v):
            return {"$float": "inf" if v > 0 else "-inf"}
        return v
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, dict):
        return {str(k): _jsonable(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_jsonable(x) for x in v]
    if hasattr(v, "item") and not isinstance(v, (str, bytes)):  # numpy scalar
        return _jsonable(v.item())
    if isinstance(v, (bytes, memoryview)):
        return bytes(v).hex()
    if v is None or isinstance(v, (str, int, bool)):
        return v
    return str(v)


def _write(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(_jsonable(obj), indent=1, sort_keys=False, allow_nan=False))


async def drain_background() -> None:
    from app.utils import background_tasks
    for _ in range(50):
        pending = [t for t in background_tasks._tasks if not t.done()]
        if not pending:
            return
        await asyncio.gather(*pending, return_exceptions=True)


# --- snapshot history (the DB a long-running deployment has) ---------------

async def seed_snapshot_history(db_url: str) -> None:
    """Rows for scoring periods 1..current-2 in the three snapshot tables.

    A fresh DB only gets the period the app itself syncs (current-1), so the
    over-time / rank-change / estimator views would have nothing to work on.
    The history is derived deterministically from the recorded standings (each
    team's totals scaled to the period with a fixed per-team/period wobble) and
    written with plain SQL, independent of the code under test.
    """
    import asyncpg
    import httpx

    from app.services.data_provider import DataProvider

    url = DataProvider().espn_standings_url
    async with httpx.AsyncClient() as client:
        data = (await client.get(url)).json()
    current = int(data["scoringPeriodId"])
    from app.config import settings
    start = settings.season_start  # same date convention as DBService.upsert_*
    ids = {0: "pts", 1: "blk", 2: "stl", 3: "ast", 6: "reb", 17: "three_pm",
           13: "fgm", 14: "fga", 15: "ftm", 16: "fta"}
    teams = []
    for t in data["teams"]:
        vals = {ids[int(k)]: float(v) for k, v in (t.get("valuesByStat") or {}).items() if int(k) in ids}
        gp = float((t.get("valuesByStat") or {}).get("42", 0.0)) or float(current * 9)
        teams.append((int(t["id"]), str(t.get("name") or t.get("abbrev")), vals, gp))

    snap, avg_rk, tot_rk = [], [], []
    for p in range(1, current - 1):
        frac = p / max(current - 1, 1)
        rows = []
        for tid, name, vals, gp in teams:
            wob = 1.0 + 0.04 * math.sin(tid * 1.7 + p * 0.9)
            r = {k: int(round(v * frac * wob)) for k, v in vals.items()}
            r["fga"] = max(r.get("fga", 0), r.get("fgm", 0))
            r["fta"] = max(r.get("fta", 0), r.get("ftm", 0))
            g = max(int(round(gp * frac)), 1)
            rows.append((tid, name, g, r))
        for tid, name, g, r in rows:
            fgp = round(r["fgm"] / r["fga"], 4) if r["fga"] else 0.0
            ftp = round(r["ftm"] / r["fta"], 4) if r["fta"] else 0.0
            snap.append((LEAGUE_ID, SEASON_ID, p, start + timedelta(days=p - 1), tid, name, g,
                         r["fgm"], r["fga"], fgp, r["ftm"], r["fta"], ftp, r["three_pm"],
                         r["reb"], r["ast"], r["stl"], r["blk"], r["pts"]))
        for target, per_game in ((avg_rk, True), (tot_rk, False)):
            cats = {}
            for tid, name, g, r in rows:
                fgp = r["fgm"] / r["fga"] if r["fga"] else 0.0
                ftp = r["ftm"] / r["fta"] if r["fta"] else 0.0
                d = 1.0 / g if per_game else 1.0
                cats[tid] = [fgp, ftp] + [r[k] * d for k in ("three_pm", "reb", "ast", "stl", "blk", "pts")]
            ranks = {tid: [] for tid in cats}
            for ci in range(8):
                vals = sorted(cats.values(), key=lambda x: x[ci])
                for tid, c in cats.items():
                    lo = sum(1 for v in vals if v[ci] < c[ci])
                    eq = sum(1 for v in vals if v[ci] == c[ci])
                    ranks[tid].append(lo + (eq + 1) / 2.0)
            for tid, name, g, r in rows:
                rk = ranks[tid]
                target.append((LEAGUE_ID, SEASON_ID, p, start + timedelta(days=p - 1), tid, name,
                               *rk, float(sum(rk))))

    conn = await asyncpg.connect(db_url)
    try:
        await conn.executemany(
            "INSERT INTO team_daily_snapshot (league_id, season_id, scoring_period_id, date, team_id,"
            " team_name, gp, fgm, fga, fg_pct, ftm, fta, ft_pct, three_pm, reb, ast, stl, blk, pts)"
            " VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)", snap)
        for table, rows in (("team_rankings_averages", avg_rk), ("team_rankings_totals", tot_rk)):
            await conn.executemany(
                f"INSERT INTO {table} (league_id, season_id, scoring_period_id, date, team_id, team_name,"
                " rk_fg_pct, rk_ft_pct, rk_three_pm, rk_reb, rk_ast, rk_stl, rk_blk, rk_pts, rk_total)"
                " VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)", rows)
    finally:
        await conn.close()
    log.warning(f"seeded snapshot history: periods 1..{current - 2}")


# --- jobs --------------------------------------------------------------------

async def run_jobs(out: Path, db_url: str) -> dict:
    from app.config import settings
    from app.main import derive_season_start
    from app.services import adp_service, injury_service, nba_player_catalog, schedule_service
    from app.services.data_provider import DataProvider
    from app.services.estimator_service import EstimatorService
    from app.services.league_activity_service import get_league_activity_service
    from app.services.model_nightly_service import ModelNightlyService
    from app.services.nba_players_refresh import refresh_nba_players_catalog
    from app.services.roster_stints.service import RosterStintsService
    from app.services.surprise_service import SurpriseService

    results: dict = {}
    timings: dict = {}

    async def step(name, coro_fn):
        t = time.perf_counter()
        try:
            res = await coro_fn()
            results[name] = res
        except Exception as e:  # recorded, not fatal: the same failure must repeat after
            log.exception(f"job {name} failed")
            results[name] = {"error": f"{type(e).__name__}: {e}"}
        await drain_background()
        timings[name] = round(time.perf_counter() - t, 2)
        log.warning(f"job {name}: {str(results[name])[:200]} ({timings[name]}s)")

    async def season_window():
        s = await derive_season_start()
        if s is not None:
            settings.season_start = s
        e = await schedule_service.get_season_end_date()
        if e is not None:
            settings.season_end = e
        return {"season_start": settings.season_start, "season_end": settings.season_end}

    await step("season_window", season_window)
    await step("nba_players_catalog", refresh_nba_players_catalog)
    await step("nba_catalog_warm", nba_player_catalog.warm_cache)

    async def injuries():
        await injury_service.initialize()
        await injury_service.update_injury_data()
        return "ok"

    await step("injuries", injuries)

    nightly = ModelNightlyService()
    await step("model_bootstrap", lambda: nightly.bootstrap(until_date=BOOTSTRAP_UNTIL))
    await step("model_catchup", lambda: nightly.run_catchup(through=(T0 - timedelta(days=1)).date()))
    await step("roster_stints", lambda: RosterStintsService().rebuild())
    await step("surprises_backfill", lambda: SurpriseService().backfill_missing())

    await step("snapshot_history", lambda: seed_snapshot_history(db_url))
    await step("standings_sync", lambda: DataProvider().sync_db_now())
    await step("estimator", lambda: EstimatorService().run_and_store(wait=True, force=True))
    await step("league_activity", lambda: get_league_activity_service().warm())

    async def adp():
        meta = await adp_service.refresh_adp_sources()
        await adp_service.ensure_daily_snapshot()
        return meta

    await step("adp", adp)
    _write(out / "jobs" / "results.json", results)
    return timings


# --- endpoints ---------------------------------------------------------------

async def endpoint_list(db_url: str) -> list[tuple[str, str, dict | None]]:
    """(method, path, json body). Ids are picked from the DB with SQL, so they
    depend on the recorded data only, never on the code under test."""
    import asyncpg

    conn = await asyncpg.connect(db_url)
    try:
        top_players = [r["player_id"] for r in await conn.fetch(
            "SELECT player_id, SUM(pts) s FROM fs_player_games WHERE season = '2026-27'"
            " GROUP BY player_id ORDER BY s DESC, player_id LIMIT 6")]
        bench_players = [r["player_id"] for r in await conn.fetch(
            "SELECT player_id, COUNT(*) c FROM fs_player_games WHERE season = '2026-27'"
            " GROUP BY player_id HAVING COUNT(*) <= 3 ORDER BY c, player_id LIMIT 2")]
        game_ids = [r["game_id"] for r in await conn.fetch(
            "SELECT DISTINCT game_id, game_date FROM fs_team_games WHERE season = '2026-27'"
            " ORDER BY game_date DESC, game_id LIMIT 3")]
        night = await conn.fetchval("SELECT MAX(game_date) FROM model_surprise_results")
        team_ids = [r["team_id"] for r in await conn.fetch(
            "SELECT DISTINCT team_id FROM team_daily_snapshot ORDER BY team_id")]
        name_rows = await conn.fetch(
            "SELECT DISTINCT ON (player_id) player_id, player_name FROM fs_player_games"
            " WHERE player_id = ANY($1::bigint[]) ORDER BY player_id, game_date DESC", top_players)
    finally:
        await conn.close()

    today = T0.date()
    yday = today - timedelta(days=1)
    week_ago = today - timedelta(days=7)
    month_start = date(2026, 11, 1)
    E: list[tuple[str, str, dict | None]] = []
    g = lambda p: E.append(("GET", p, None))  # noqa: E731

    g("/health")
    # rankings / league / analytics
    for q in ("order=asc", "order=desc", "sort_by=PTS&order=desc", "sort_by=FG%25&order=asc",
              f"order=asc&start_date={week_ago}&end_date={yday}",
              f"order=asc&start_date={month_start}&end_date={today}&settled=true"):
        g(f"/api/rankings?{q}")
    g("/api/league/summary")
    g("/api/league/shots")
    g("/api/league/today")
    for q in ("mode=averages", "mode=totals", "mode=averages&settled=true", "mode=totals&settled=true"):
        g(f"/api/league/rank-changes?{q}")
    g("/api/league/draft-report")
    g("/api/league/activity")
    g("/api/league/activity/latest?limit=8")
    g("/api/league/activity/latest?limit=50")
    g("/api/analytics/heatmap")
    g(f"/api/analytics/heatmap?start_date={week_ago}&end_date={yday}")
    for src in ("rankings_avg", "rankings_totals", "snapshot", "averages"):
        g(f"/api/analytics/over-time?source={src}")
    g(f"/api/analytics/over-time?source=rankings_avg&team_ids={team_ids[0]},{team_ids[-1]}")
    # teams
    g("/api/teams/")
    for tid in team_ids:
        g(f"/api/teams/{tid}?time_period=season")
        g(f"/api/teams/{tid}/players")
    for tp in ("last_night", "last_7", "last_15", "last_30"):
        g(f"/api/teams/{team_ids[0]}?time_period={tp}")
        g(f"/api/teams/{team_ids[-1]}?time_period={tp}")
    g(f"/api/teams/{team_ids[0]}?time_period=custom&start={month_start}&end={yday}")
    for tid in (team_ids[0], team_ids[-1]):
        g(f"/api/teams/{tid}/roster-day")
        g(f"/api/teams/{tid}/roster-day?date={yday}")
        g(f"/api/teams/{tid}/roster-day?date={week_ago}")
    # players
    for tp in ("season", "last_night", "last_7", "last_15", "last_30"):
        g(f"/api/players/?page=1&limit=1200&time_period={tp}")
    g("/api/players/?page=2&limit=500&time_period=season")
    g(f"/api/players/?page=1&limit=1200&time_period=custom&start={month_start}&end={yday}")
    # estimator / injuries
    g("/api/estimator/results")
    g("/api/injuries/")
    g("/api/injuries/notifications")
    g("/api/injuries/status")
    # NBA teams / schedule / box scores / with-without
    g("/api/nba-teams/")
    for t in (1, 2, 13, 25):
        g(f"/api/nba-teams/{t}/depthchart")
    g("/api/nba/schedule")
    g("/api/nba/season")
    for d in (yday, today, week_ago):
        g(f"/api/nba/scoreboard?date={d}")
        g(f"/api/nba/scoreboard/values?date={d}")
    for gid in game_ids:
        g(f"/api/nba/games/{gid}/boxscore")
    g("/api/nba/with-without/teams")
    for t in (2, 13, 25):
        g(f"/api/nba/with-without/{t}")
    # NBA players
    for pid in top_players[:4] + bench_players:
        g(f"/api/nba-players/{pid}")
        g(f"/api/nba-players/{pid}/games")
        g(f"/api/nba-players/{pid}/seasons")
        for tp in ("season", "last_7", "last_30"):
            g(f"/api/nba-players/{pid}/stats?time_period={tp}")
        g(f"/api/nba-players/{pid}/stats?time_period=custom&start={month_start}&end={yday}")
        g(f"/api/league/players/{pid}/history")
    # matchups / projections / feature store
    g("/api/matchups/dates")
    g("/api/matchups/upcoming-dates")
    g("/api/matchups/current-slate-date")
    g("/api/matchups/today")
    g(f"/api/matchups/today?date={(today + timedelta(days=1)):%Y%m%d}")
    for pid in top_players[:4] + bench_players:
        g(f"/api/projections/player/{pid}")
    if top_players:
        names = {r["player_id"]: r["player_name"] for r in name_rows}
        E.append(("POST", "/api/projections/predict",
                  {"player_name": names[top_players[0]], "opponent": "BOS", "is_home": True, "minutes": 30.0}))
        E.append(("POST", "/api/projections/predict",
                  {"player_name": names[top_players[1]], "opponent": "LAL", "is_home": False, "minutes": 22.5}))
    g("/api/feature-store/players")
    g("/api/feature-store/teams")
    for pid in top_players[:3]:
        g(f"/api/feature-store/players/{pid}/state")
    for t in (1, 13):
        g(f"/api/feature-store/teams/{t}/state")
    # trends
    for w in (5, 15, 30, 60):
        g(f"/api/trends/minutes?window_days={w}")
        g(f"/api/trends/usage?window_days={w}")
        g(f"/api/trends/categories?window_days={w}")
    for q in ("window_days=15&baseline_seasons=2&mode=season", "window_days=15&baseline_seasons=0&mode=form",
              "window_days=30&baseline_seasons=1&mode=season"):
        g(f"/api/trends/regression?{q}")
    for pid in top_players[:3]:
        g(f"/api/trends/player/{pid}/gamelog?window_days=15&baseline_seasons=2&mode=season")
        g(f"/api/trends/player/{pid}/gamelog?window_days=15&baseline_seasons=0&mode=form")
    # surprises
    g("/api/surprises/dates")
    g("/api/surprises/latest")
    if night:
        g(f"/api/surprises/{night}")
        g(f"/api/surprises/{night - timedelta(days=1)}")
    for ms in (2.0, 3.0):
        g(f"/api/surprises/period?start={month_start}&end={yday}&min_score={ms}")
    # ADP
    g("/api/adp?page=1&page_size=50&sort=blend&sort_dir=asc&ranked_only=true")
    g("/api/adp?page=2&page_size=50&sort=espn&sort_dir=desc&ranked_only=true&pos=PG")
    g("/api/adp?page=1&page_size=2000&sort=blend&sort_dir=asc&ranked_only=false&include_stats=false")
    g("/api/adp?page=1&page_size=50&sort=blend&sort_dir=asc&ranked_only=true&q=james&metric=rank")
    g("/api/adp/index")
    g("/api/adp/index?metric=rank")
    for mode in ("range", "since_start"):
        g(f"/api/adp/movers?metric=adp&mode={mode}&top=150&limit=10")
    # minigames
    g("/api/minigames/teams")
    g("/api/minigames/who-am-i/leaderboard")
    return E


def _slug(i: int, method: str, path: str) -> str:
    s = path.strip("/").replace("/", "_").replace("?", "__").replace("&", "_").replace("=", "-")
    s = s.replace("%25", "pct").replace(",", "-")
    return f"{i:03d}_{method}_{s}"[:150]


async def hit_endpoints(out: Path, endpoints) -> dict:
    import httpx

    from app.main import app

    lat: dict = {}
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://golden") as client:
        for rnd in ("first", "cached"):
            for i, (method, path, body) in enumerate(endpoints):
                t = time.perf_counter()
                resp = await client.request(method, path, json=body)
                await drain_background()
                lat.setdefault(path if method == "GET" else f"{method} {path}", {})[rnd] = round(
                    (time.perf_counter() - t) * 1000, 1)
                try:
                    payload = resp.json()
                except ValueError:
                    payload = {"$text": resp.text[:2000]}
                _write(out / "endpoints" / rnd / f"{_slug(i, method, path)}.json",
                       {"method": method, "path": path, "status": resp.status_code, "body": payload})
    return lat


# --- model path ---------------------------------------------------------------

async def dump_model(out: Path) -> None:
    """Feature vectors + predictions for every stored player, floats as hex."""
    import numpy as np

    from app.services.model_nightly_service import ModelNightlyService
    from model_stats_inference.serving.inference import LiveInference, PredictionRequest

    store = await ModelNightlyService().get_inference_store(refresh=True)
    if store is None:
        _write(out / "model" / "store.json", {"store": None})
        return
    inference = LiveInference(store)

    def frame_rows(frame):
        cols = list(frame.columns)
        data = {c: frame[c].to_list() if hasattr(frame[c], "to_list") else list(frame[c]) for c in cols}
        rows = []
        for i in range(len(frame)):
            row = {}
            for c in cols:
                v = data[c][i]
                if isinstance(v, (float, np.floating)):
                    row[c] = float(v).hex()
                elif c == "last_game_date" and v is not None:
                    # pandas held a midnight Timestamp, Polars a date: same day
                    row[c] = str(v)[:10]
                else:
                    row[c] = _jsonable(v)
            rows.append(row)
        # SELECT * without ORDER BY: the store's row order is the heap's, not data
        key = "PLAYER_ID" if "PLAYER_ID" in cols else "TEAM_ID"
        rows.sort(key=lambda r: int(r[key]))
        return {"columns": cols, "rows": rows}

    _write(out / "model" / "player_vectors.json", frame_rows(store.player_vectors))
    _write(out / "model" / "team_allowed_vectors.json", frame_rows(store.team_allowed_vectors))
    _write(out / "model" / "team_own_vectors.json", frame_rows(store.team_own_vectors))

    players = sorted(int(p) for p in store.player_vectors["PLAYER_ID"].to_list())
    teams = sorted(int(t) for t in store.team_allowed_vectors["TEAM_ID"].to_list())
    game_day = datetime(2026, 11, 20)
    reqs = [PredictionRequest(p, teams[i % len(teams)], bool(i % 2), game_day, 18.0 + (i % 5) * 4.0)
            for i, p in enumerate(players)]
    preds, errors = inference.predict_many(reqs)
    hx = lambda v: None if v is None else float(v).hex()  # noqa: E731
    rows = []
    for r, p, e in zip(reqs, preds, errors):
        rows.append({
            "player_id": r.player_id, "opp": r.opponent_team_id, "home": r.is_home, "minutes": r.minutes,
            "error": None if e is None else f"{type(e).__name__}: {e}",
            "pred": None if p is None else {
                "minutes": hx(p.minutes),
                "stats": {k: [hx(sp.value), hx(sp.low), hx(sp.high)] for k, sp in sorted(p.stats.items())},
            },
        })
    _write(out / "model" / "predictions.json", rows)


# --- DB dump -------------------------------------------------------------------

async def dump_db(out: Path, db_url: str) -> None:
    import asyncpg

    conn = await asyncpg.connect(db_url)
    try:
        tables = [r["table_name"] for r in await conn.fetch(
            "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1")]
        for t in tables:
            cols = [r["column_name"] for r in await conn.fetch(
                "SELECT column_name FROM information_schema.columns WHERE table_name=$1"
                " ORDER BY ordinal_position", t)]
            keep = [c for c in cols if not c.endswith("_at")]
            order = ", ".join(f'"{c}"::text' for c in keep)
            rows = await conn.fetch(f'SELECT {", ".join(chr(34) + c + chr(34) for c in keep)} FROM {t} ORDER BY {order}')
            _write(out / "db" / f"{t}.json", {"columns": keep, "rows": [list(r.values()) for r in rows]})
    finally:
        await conn.close()


# --- main ----------------------------------------------------------------------

async def amain(args) -> None:
    import numpy as np

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    from golden.pg import LocalPostgres
    from golden.tape import Tape

    pg = LocalPostgres(port=args.port).start()
    _env(pg.url)
    tape = Tape(Path(args.tape), args.mode)
    tape.install()

    # The estimator's Monte Carlo draws from an unseeded generator; pin it.
    _orig_rng = np.random.default_rng
    np.random.default_rng = lambda seed=None, *a, **k: _orig_rng(12345 if seed is None else seed, *a, **k)

    import time_machine
    traveller = time_machine.travel(T0, tick=False)
    traveller.start()
    try:
        from model_stats_inference.espn import client as espn_client
        if args.mode == "replay":
            espn_client.SLEEP_BETWEEN_CALLS = 0.0
            espn_client.RETRY_DELAYS = []
        from model_stats_inference.research import config as rconfig
        rconfig.SEASONS = args.seasons.split(",")
        # The bootstrap month-caches parquet under DATA_DIR; a fresh dir per run
        # keeps runs from reading each other's caches (both sides fetch alike).
        import tempfile
        rconfig.DATA_DIR = Path(tempfile.mkdtemp(prefix="golden-espn-"))

        t = time.perf_counter()
        timings = await run_jobs(out, pg.url)
        endpoints = await endpoint_list(pg.url)
        lat = await hit_endpoints(out, endpoints)
        await dump_model(out)
        await dump_db(out, pg.url)
        _write(out / "meta.json", {
            "t0": T0, "seasons": rconfig.SEASONS, "job_seconds": timings,
            "endpoint_ms": lat, "total_seconds": round(time.perf_counter() - t, 1),
            "tape_misses": sorted(set(tape.misses)), "tape_requests": len(tape.requests),
        })
        _write(out / "requests.json", sorted(set(tape.requests)))
        log.warning(f"done in {time.perf_counter() - t:.0f}s; tape misses: {len(set(tape.misses))}")
    finally:
        traveller.stop()
        tape.uninstall()
        try:
            from app.services.db_service import DBService
            await DBService().close()
        except Exception:
            pass
        if not args.keep_db:
            pg.stop()
        else:
            print("DB kept at", pg.url, pg.dir)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--tape", default=str(HERE / "_data" / "tape"))
    ap.add_argument("--mode", choices=["record", "replay"], default="replay")
    ap.add_argument("--port", type=int, default=55432)
    ap.add_argument("--seasons", default="2022-23,2023-24,2024-25,2025-26,2026-27")
    ap.add_argument("--keep-db", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(level=logging.WARNING, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    asyncio.run(amain(args))


if __name__ == "__main__":
    main()

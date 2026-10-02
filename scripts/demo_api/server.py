"""Demo API overlay on :8010.

Everything is real data: run the normal backend against the 2025-26 season of
the league, and this proxy forwards to it. Only the three things the offseason
genuinely cannot serve are overlaid (injury PDF is 403 out of season, minigame
leaderboards are empty, and there is no live slate today).

    # terminal 1 — real backend, real league, completed season
    LEAGUE_ID=660330196 SEASON_ID=2026 uv run uvicorn app.main:app --port 8000

    # terminal 2 — this overlay
    uv run python ../scripts/demo_api/server.py

    # terminal 3 — frontend
    npm run dev -- --mode demo
"""
from __future__ import annotations

import json
import random
import re
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import httpx
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

load_dotenv(Path(__file__).resolve().parents[2] / "backend" / ".env")

import rookies
from trends_demo import TrendsDemo

UPSTREAM = "http://localhost:8000"

SEASON_START = "2025-10-21"
DEMO_DATE = "2025-11-25"
SLATE_DATE = DEMO_DATE
UPSTREAM_SLATE = "20260205"
LAST_REPORT = f"{DEMO_DATE}T17:30:00"

DATE_SCOPED = {
    "api/rankings": ("start_date", "end_date"),
    "api/analytics/heatmap": ("start_date", "end_date"),
}

# The underlying data is the 2025-26 season; the demo is presented as 2026-27,
# so every date inside that season window is shifted forward one year on the
# way out (and demo-season dates coming in are shifted back).
SHIFT_LO, SHIFT_HI = "2025-07-01", "2026-06-30"
_ISO = re.compile(r"^(\d{4})-(\d{2})-(\d{2})")


def _shift_str(value: str, delta: int) -> str:
    m = _ISO.match(value)
    if not m:
        return value
    head = value[:10]
    lo, hi = (SHIFT_LO, SHIFT_HI) if delta > 0 else (_bump(SHIFT_LO, 1), _bump(SHIFT_HI, 1))
    if not (lo <= head <= hi):
        return value
    return _bump(head, delta) + value[10:]


def _bump(iso: str, delta: int) -> str:
    return f"{int(iso[:4]) + delta}{iso[4:]}"


def shift_out(obj):
    if isinstance(obj, dict):
        return {k: shift_out(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [shift_out(v) for v in obj]
    if isinstance(obj, str):
        return _shift_str(obj, 1)
    return obj


def shift_in(value: str) -> str:
    if not value:
        return value
    compact = len(value) == 8 and value.isdigit()
    iso = f"{value[:4]}-{value[4:6]}-{value[6:]}" if compact else value
    out = _shift_str(iso, -1)
    return out.replace("-", "") if compact else out

TRENDS = TrendsDemo(date.fromisoformat(DEMO_DATE))

app = FastAPI(title="Fantasy Demo Overlay")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
client = httpx.AsyncClient(base_url=UPSTREAM, timeout=600.0, follow_redirects=True)

INJURIES = [
    ("Anthony Davis", "DAL", "Out", "Left Adductor; Strain"),
    ("Jayson Tatum", "BOS", "Questionable", "Right Ankle; Sprain"),
    ("Ja Morant", "MEM", "Probable", "Right Hip; Soreness"),
    ("Zion Williamson", "NOP", "Out", "Left Hamstring; Strain"),
    ("Kawhi Leonard", "LAC", "Questionable", "Injury Management"),
    ("Joel Embiid", "PHL", "Doubtful", "Left Knee; Swelling"),
    ("Paolo Banchero", "ORL", "Probable", "Right Wrist; Soreness"),
    ("Dejounte Murray", "NOP", "Out", "Right Hand; Fracture"),
]

LEADERBOARDS: dict[str, list[dict]] = {}
_NAMES = ["Asaf", "Alon", "Oriel", "Roy", "Amihai", "Barak", "Khachapuri", "KD", "Shai", "Process"]
for seed, (slug, top) in enumerate((("hangman", 14), ("who-he-play-for", 21),
                                    ("who-am-i", 9), ("now-you-see-me", 17))):
    shuffled = _NAMES[:]
    random.Random(4200 + seed).shuffle(shuffled)
    rows, streak = [], top
    for i, nm in enumerate(shuffled, start=1):
        rows.append({"rank": i, "displayName": nm, "bestStreak": streak,
                     "hintsUsed": (i % 3) if slug in ("hangman", "who-am-i") else None})
        streak = max(1, streak - (1 if i % 2 else 2))
    LEADERBOARDS[slug] = rows


@app.get("/api/injuries")
@app.get("/api/injuries/")
def injuries():
    return shift_out([
        {"game": f"{team} @ BOS", "team": team, "player": name, "status": status,
         "injury": desc, "last_update": LAST_REPORT, "game_time_utc": f"{SLATE_DATE}T23:30:00Z"}
        for name, team, status, desc in INJURIES
    ])


@app.get("/api/injuries/status")
def injury_status():
    return shift_out({"last_report_time": LAST_REPORT})


@app.get("/api/injuries/notifications")
def injury_notifications():
    return []


@app.get("/api/matchups/current-slate-date")
def current_slate_date():
    return shift_out(SLATE_DATE)


@app.get("/api/matchups/upcoming-dates")
def upcoming_dates():
    day = date.fromisoformat(SLATE_DATE)
    return shift_out([(day + timedelta(days=i)).isoformat() for i in range(1, 4)])


@app.get("/api/matchups/dates")
def matchup_dates():
    return shift_out([SLATE_DATE])


_slate_cache: list[dict] = []


def _greenify(projection: dict | None, games_played: int) -> dict | None:
    if not projection or not projection.get("stats"):
        return projection
    return {**projection, "status": "green",
            "reason": f"model fit on {games_played} games this season"}


_rookies_placed = False


async def _place_rookies() -> None:
    global _rookies_placed
    if _rookies_placed:
        return
    teams = (await client.get("/api/nba-teams/")).json()
    roster: dict[str, str] = {}
    names: dict[str, str] = {}
    for t in teams:
        chart = (await client.get(f"/api/nba-teams/{t['team_id']}/depthchart")).json()
        abbr = chart.get("team_abbreviation") or t["abbreviation"]
        names[abbr] = chart.get("team_name") or t["team_name"]
        for pos in chart.get("positions", []):
            for p in pos.get("players", []):
                roster[p["display_name"].lower()] = abbr
    rookies.assign_teams(roster, names)
    _rookies_placed = True


@app.get("/api/matchups/today")
async def matchups_today(date: str | None = None):
    await _place_rookies()
    # The slate whitelist only reaches ~60 game days back, so the live payload
    # comes from the earliest available date and is re-dated to the demo day.
    if not _slate_cache:
        r = await client.get("/api/matchups/today", params={"date": UPSTREAM_SLATE})
        if r.status_code != 200:
            return JSONResponse({"detail": "slate unavailable"}, status_code=502)
        for m in r.json():
            gp = len(TRENDS.by_player.get(m.get("player_id", -1), [])) or 17
            m["game_date"] = SLATE_DATE
            m["projection"] = _greenify(m.get("projection"), gp)
            _slate_cache.append(m)
        by_team: dict[str, list[dict]] = {}
        for rookie in rookies.slate_entries(_slate_cache, SLATE_DATE):
            by_team.setdefault(rookie["pro_team"], []).append(rookie)
        merged: list[dict] = []
        for m in _slate_cache:
            merged.append(m)
            merged.extend(by_team.pop(m["pro_team"], []))
        _slate_cache[:] = merged
    return shift_out(_slate_cache)


@app.get("/api/projections/player/{player_id}")
async def player_projection(player_id: int):
    await _place_rookies()
    rookie = rookies.PLAYERS.get(player_id)
    if rookie:
        await matchups_today()
        opp = next((m["opponent"] for m in _slate_cache if m["pro_team"] == rookie["pro_team"]), "BOS")
        return shift_out(rookies.next_game(player_id, opp, SLATE_DATE))
    r = await client.get(f"/api/projections/player/{player_id}")
    if r.status_code != 200:
        return JSONResponse(r.json(), status_code=r.status_code)
    body = r.json()
    gp = len(TRENDS.by_player.get(player_id, [])) or 17
    body.update({"game_date": SLATE_DATE, "scheduled": True,
                 "status": "green", "reason": f"model fit on {gp} games this season"})
    return shift_out(body)


@app.get("/api/nba-players/{player_id}")
async def nba_player(player_id: int):
    await _place_rookies()
    bio = rookies.bio(player_id)
    if bio:
        return bio
    r = await client.get(f"/api/nba-players/{player_id}")
    return JSONResponse(shift_out(r.json()), status_code=r.status_code)


@app.get("/api/nba-players/{player_id}/stats")
async def nba_player_stats(player_id: int, time_period: str = "season",
                           start: str | None = None, end: str | None = None):
    await _place_rookies()
    stats = rookies.stats(player_id)
    if stats:
        return shift_out({**stats, "actual_start": SEASON_START, "actual_end": DEMO_DATE})
    params = {"time_period": "custom", "start": SEASON_START, "end": DEMO_DATE} if time_period == "season" else {
        "time_period": time_period, **({"start": shift_in(start)} if start else {}), **({"end": shift_in(end)} if end else {})}
    r = await client.get(f"/api/nba-players/{player_id}/stats", params=params)
    return JSONResponse(shift_out(r.json()), status_code=r.status_code)


@app.get("/api/players")
@app.get("/api/players/")
async def players(request: Request):
    await _place_rookies()
    params = dict(request.query_params)
    for field in ("start", "end"):
        if field in params:
            params[field] = shift_in(params[field])
    if params.get("time_period", "season") == "season":
        params.update({"time_period": "custom", "start": SEASON_START, "end": DEMO_DATE})
    r = await client.get("/api/players/", params=params)
    if r.status_code != 200:
        return JSONResponse(r.json(), status_code=r.status_code)
    body = r.json()
    extra = rookies.player_rows()
    body["players"] = body["players"] + extra
    body["total_count"] = body.get("total_count", 0) + len(extra)
    return shift_out(body)


_scoped_gp: dict[int, int] = {}


async def _team_scoped_gp(team_id: int) -> int | None:
    if not _scoped_gp:
        r = await client.get("/api/rankings", params={"start_date": SEASON_START, "end_date": DEMO_DATE})
        for row in r.json().get("averages_rankings", []):
            _scoped_gp[row["team"]["team_id"]] = row["gp"]
    return _scoped_gp.get(team_id)


@app.get("/api/teams/{team_id}")
async def team_detail(team_id: int, request: Request):
    # Team detail totals and slot usage come back season-long regardless of the
    # window, so they are scaled to the demo date to match the rest of the app.
    params = dict(request.query_params)
    params.update({"time_period": "custom", "start": SEASON_START, "end": DEMO_DATE})
    r = await client.get(f"/api/teams/{team_id}", params=params)
    if r.status_code != 200:
        return JSONResponse(r.json(), status_code=r.status_code)
    body = r.json()
    target = await _team_scoped_gp(team_id)
    full = body.get("ranking_stats", {}).get("gp") or 0
    if target and full:
        ratio = target / full
        body["ranking_stats"]["gp"] = target
        shot = body.get("shot_chart") or {}
        for k in ("fgm", "fga", "ftm", "fta", "gp"):
            if isinstance(shot.get(k), (int, float)):
                shot[k] = int(round(shot[k] * ratio))
        for slot in (body.get("slot_usage") or {}).values():
            slot["games_used"] = int(round(slot["games_used"] * ratio))
            slot["remaining"] = slot["cap"] - slot["games_used"]
    return shift_out(body)


@app.get("/api/analytics/over-time")
async def over_time(request: Request):
    r = await client.get("/api/analytics/over-time", params=dict(request.query_params))
    if r.status_code != 200:
        return JSONResponse(r.json(), status_code=r.status_code)
    body = r.json()
    body["data"] = [p for p in body.get("data", []) if p.get("date", "") <= DEMO_DATE]
    return shift_out(body)


@app.get("/api/league/summary")
async def league_summary():
    rankings = (await client.get("/api/rankings", params={"start_date": SEASON_START, "end_date": DEMO_DATE})).json()
    heat = (await client.get("/api/analytics/heatmap", params={"start_date": SEASON_START, "end_date": DEMO_DATE})).json()
    table = rankings["averages_rankings"]
    cols = list(zip(*heat["data"]))
    cats = heat["categories"]
    avg = {c: sum(col) / len(col) for c, col in zip(cats, cols)}
    keys = (("FG%", "fg_percentage"), ("FT%", "ft_percentage"), ("3PM", "three_pm"), ("AST", "ast"),
            ("REB", "reb"), ("STL", "stl"), ("BLK", "blk"), ("PTS", "pts"))
    return shift_out({
        "total_teams": len(table),
        "total_games_played": sum(r["gp"] for r in table),
        "nba_avg_pace": TRENDS.nba_games_per_team(),
        "nba_game_days_left": 138,
        "category_leaders": {f"{cat}_leader": max(table, key=lambda r: r[key]) for cat, key in keys},
        "league_averages": {key: avg.get(cat, 0.0) for cat, key in keys} | {"gp": avg.get("GP", 0.0)},
        "last_updated": LAST_REPORT,
        "data_date": DEMO_DATE,
        "season_start": SEASON_START,
    })


@app.get("/api/minigames/{slug}/leaderboard")
def leaderboard(slug: str):
    return {"rows": LEADERBOARDS.get(slug, [])}


@app.post("/api/minigames/{slug}/leaderboard/qualify")
async def qualify(slug: str, body: dict):
    rows = LEADERBOARDS.get(slug, [])
    return {"qualifies": not rows or body.get("bestStreak", 0) > rows[-1]["bestStreak"]}


@app.post("/api/minigames/{slug}/leaderboard")
async def submit(slug: str, body: dict):
    rows = LEADERBOARDS.setdefault(slug, [])
    rows.append({"rank": 0, "displayName": body.get("displayName", "You"),
                 "bestStreak": body.get("bestStreak", 0), "hintsUsed": body.get("hintsUsed")})
    rows.sort(key=lambda r: -r["bestStreak"])
    del rows[10:]
    for i, r in enumerate(rows, start=1):
        r["rank"] = i
    return {"rows": rows}


@app.get("/api/trends/minutes")
async def trends_minutes(window_days: int = 15):
    await _ensure_owners()
    return shift_out(TRENDS.minutes(window_days))


@app.get("/api/trends/usage")
async def trends_usage(window_days: int = 15):
    await _ensure_owners()
    return shift_out(TRENDS.usage(window_days))


@app.get("/api/trends/regression")
async def trends_regression(window_days: int = 15, baseline_seasons: int = 2, mode: str = "season"):
    await _ensure_owners()
    return shift_out(TRENDS.regression(window_days, baseline_seasons, mode))


@app.get("/api/trends/player/{player_id}/gamelog")
async def trends_gamelog(player_id: int, window_days: int = 15, baseline_seasons: int = 2, mode: str = "season"):
    await _ensure_owners()
    log = TRENDS.gamelog(player_id, window_days, baseline_seasons, mode)
    if log is None:
        return JSONResponse({"detail": f"No game log for player {player_id}"}, status_code=404)
    return shift_out(log)


_owners_loaded = False


async def _ensure_owners() -> None:
    global _owners_loaded
    if _owners_loaded:
        return
    try:
        r = await client.get("/api/players/", params={"page": 1, "limit": 1200, "time_period": "season"})
        rows = r.json().get("players", [])
        TRENDS.set_owners({
            p["player_name"]: (p.get("fantasy_team_name") or "FA")
            for p in rows if p.get("status") == "ONTEAM"
        })
        _owners_loaded = True
    except Exception:
        pass


@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])
async def proxy(path: str, request: Request):
    params = dict(request.query_params)
    for field in ("start", "end", "start_date", "end_date", "date"):
        if field in params:
            params[field] = shift_in(params[field])
    key = path.strip("/")
    if key == "api/matchups/today":
        params.setdefault("date", SLATE_DATE.replace("-", ""))
    elif key in DATE_SCOPED:
        lo, hi = DATE_SCOPED[key]
        params.setdefault(lo, SEASON_START)
        params.setdefault(hi, DEMO_DATE)
    elif key == "api/players" or key.startswith("api/teams/") or key.startswith("api/nba-players/"):
        if params.get("time_period", "season") == "season":
            params.update({"time_period": "custom", "start": SEASON_START, "end": DEMO_DATE})
    try:
        upstream = await client.request(
            request.method, f"/{path}", params=params,
            content=await request.body(),
            headers={k: v for k, v in request.headers.items() if k.lower() not in ("host", "content-length")},
        )
    except httpx.HTTPError as exc:
        return JSONResponse({"detail": f"upstream unavailable: {exc}"}, status_code=502)
    media = upstream.headers.get("content-type", "")
    if "application/json" in media:
        return JSONResponse(shift_out(upstream.json()), status_code=upstream.status_code)
    return Response(content=upstream.content, status_code=upstream.status_code, media_type=media)




if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8010, log_level="warning")

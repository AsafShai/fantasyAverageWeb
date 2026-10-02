"""Pull the real 2026-27 NBA schedule (ESPN scoreboard) up to the demo date.

Output: snapshots/nba_schedule.json — {"YYYY-MM-DD": [[home_abbr, away_abbr], ...]}
"""
import json
import sys
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx

OUT = Path(__file__).parent / "snapshots" / "nba_schedule.json"
BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard"
HEADERS = {"User-Agent": "Mozilla/5.0"}

SEASON_START = date(2026, 10, 20)
THROUGH = date(2027, 1, 13)


def main() -> int:
    client = httpx.Client(timeout=40.0, headers=HEADERS)

    r = client.get(BASE, params={"calendartype": "whitelist", "dates": SEASON_START.strftime("%Y%m%d")})
    r.raise_for_status()
    cal = r.json()["leagues"][0]["calendar"]
    days = []
    for entry in cal:
        d = datetime.fromisoformat(entry.replace("Z", "+00:00")).astimezone(ZoneInfo("America/New_York")).date()
        if SEASON_START <= d <= THROUGH:
            days.append(d)
    days = sorted(set(days))
    print(f"{len(days)} game days {days[0]} .. {days[-1]}")

    sched: dict[str, list[list[str]]] = {}
    for i, d in enumerate(days):
        try:
            resp = client.get(BASE, params={"dates": d.strftime("%Y%m%d")})
            resp.raise_for_status()
            events = resp.json().get("events", [])
        except Exception as exc:
            print(f"  !! {d}: {exc}")
            continue
        games = []
        for ev in events:
            comps = ev.get("competitions", [{}])[0].get("competitors", [])
            home = next((c["team"]["abbreviation"] for c in comps if c.get("homeAway") == "home"), None)
            away = next((c["team"]["abbreviation"] for c in comps if c.get("homeAway") == "away"), None)
            if home and away:
                games.append([home, away])
        sched[d.isoformat()] = games
        if i % 20 == 0:
            print(f"  {i}/{len(days)}  {d} -> {len(games)} games")

    OUT.write_text(json.dumps(sched), encoding="utf-8")
    total = sum(len(v) for v in sched.values())
    print(f"saved {len(sched)} days, {total} games")
    return 0


if __name__ == "__main__":
    sys.exit(main())

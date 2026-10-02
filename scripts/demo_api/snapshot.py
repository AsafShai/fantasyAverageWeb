"""Snapshot real backend responses that still work in the offseason.

Run once with the real backend up on :8000. Output feeds the demo API server,
which never needs the live backend afterwards.
"""
import json
import sys
from pathlib import Path

import httpx

BASE = "http://localhost:8000/api"
OUT = Path(__file__).parent / "snapshots"

CLIENT = httpx.Client(timeout=240.0)


def grab(path: str, name: str) -> object | None:
    try:
        r = CLIENT.get(f"{BASE}{path}", follow_redirects=True)
        r.raise_for_status()
        data = r.json()
    except Exception as exc:
        print(f"  !! {path}: {exc}")
        return None
    (OUT / f"{name}.json").write_text(json.dumps(data), encoding="utf-8")
    print(f"  ok {name:<28} {len(json.dumps(data)):>9,} bytes")
    return data


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)

    print("core:")
    grab("/teams/", "fantasy_teams")
    grab("/minigames/players", "minigame_players")
    grab("/matchups/today", "matchups_today")
    grab("/matchups/dates", "matchup_dates")
    grab("/feature-store/players", "fs_players")
    grab("/feature-store/teams", "fs_teams")
    nba_teams = grab("/nba-teams/", "nba_teams")

    print("player pool:")
    pool = []
    for page in (1, 2):
        d = grab(f"/players/?page={page}&limit=1000", f"players_p{page}")
        if d:
            pool.extend(d["players"])
    (OUT / "player_pool.json").write_text(json.dumps(pool), encoding="utf-8")
    print(f"  pool size: {len(pool)}")

    print("depth charts:")
    charts = {}
    for t in nba_teams or []:
        try:
            r = CLIENT.get(f"{BASE}/nba-teams/{t['team_id']}/depthchart")
            r.raise_for_status()
            charts[t["team_id"]] = r.json()
        except Exception as exc:
            print(f"  !! {t['abbreviation']}: {exc}")
    (OUT / "depth_charts.json").write_text(json.dumps(charts), encoding="utf-8")
    print(f"  {len(charts)} charts")

    print("projections + bios for rostered-size sample:")
    ids = [p["player_id"] for p in pool if p.get("player_id")][:420]
    projections, bios = {}, {}
    for i, pid in enumerate(ids):
        for store, path in ((projections, f"/projections/player/{pid}"), (bios, f"/nba-players/{pid}")):
            try:
                r = CLIENT.get(f"{BASE}{path}")
                if r.status_code == 200:
                    store[str(pid)] = r.json()
            except Exception:
                pass
        if i % 50 == 0:
            print(f"  {i}/{len(ids)}")
    (OUT / "projections.json").write_text(json.dumps(projections), encoding="utf-8")
    (OUT / "bios.json").write_text(json.dumps(bios), encoding="utf-8")
    print(f"  projections {len(projections)} · bios {len(bios)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

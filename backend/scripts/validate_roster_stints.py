"""Check roster stints against a whole season of real box scores.

Builds the stints the nightly job would build (real NBA movement feed, real
ESPN rosters and box scores), then for every team-game counts the players on
the roster that day. A real NBA roster is 13-18 (15 standard + up to 3
two-way), so anything outside that range is printed for a closer look.

Needs no database: box scores come from ESPN directly. Run from backend/:

    PYTHONPATH=. uv run python scripts/validate_roster_stints.py [--cache DIR]

--cache keeps the fetched season as parquet so later runs skip ESPN.
"""

from __future__ import annotations

import argparse
import asyncio
import collections
from datetime import date
from pathlib import Path

import pandas as pd

from app.services.roster_stints.feed import fetch_feed
from app.services.roster_stints.service import _fetch_espn_rosters, compute_stints, current_season, eastern_today
from model_stats_inference.espn.games import fetch_month, season_months
from model_stats_inference.espn.teams import TEAM_ID_TO_ABBR


def load_season(season: str, cache: Path | None) -> tuple[pd.DataFrame, pd.DataFrame]:
    if cache and (cache / "players.parquet").exists():
        return pd.read_parquet(cache / "players.parquet"), pd.read_parquet(cache / "teams.parquet")
    today = eastern_today()
    players, teams = [], []
    for ym in season_months(season):
        if date(int(ym[:4]), int(ym[4:]), 1) > today:
            break
        p, t = fetch_month(ym)
        p, t = p.to_pandas(), t.to_pandas()   # espn returns Polars; this offline check works in pandas
        players.append(p)
        teams.append(t)
        print(f"fetched {ym}: {len(t) // 2} games")
    p, t = pd.concat(players, ignore_index=True), pd.concat(teams, ignore_index=True)
    if cache:
        cache.mkdir(parents=True, exist_ok=True)
        p.to_parquet(cache / "players.parquet")
        t.to_parquet(cache / "teams.parquet")
    return p, t


async def main(cache: Path | None) -> None:
    season = current_season()
    today = eastern_today()
    players, teams = load_season(season, cache)
    players["GAME_DATE"] = pd.to_datetime(players["GAME_DATE"]).dt.date
    teams["GAME_DATE"] = pd.to_datetime(teams["GAME_DATE"]).dt.date
    season_start = min(teams["GAME_DATE"])
    feed, rosters = await asyncio.gather(fetch_feed(), _fetch_espn_rosters())
    appearances = [
        (int(r.PLAYER_ID), r.PLAYER_NAME, int(r.TEAM_ID), r.GAME_DATE)
        for r in players.itertuples()
    ]
    stints, unmatched = compute_stints(feed, appearances, rosters, season_start, today)

    by_team: dict[int, list[tuple[int, object]]] = collections.defaultdict(list)
    for pid, ss in stints.items():
        for s in ss:
            by_team[s.team_id].append((pid, s))
    played = players.groupby(["TEAM_ID", "GAME_ID"])["PLAYER_ID"].apply(set).to_dict()

    sizes = collections.Counter()
    odd = []
    outside = 0
    for g in teams.itertuples():
        on = {pid for pid, s in by_team[int(g.TEAM_ID)] if s.covers(g.GAME_DATE)}
        p = played.get((g.TEAM_ID, g.GAME_ID), set())
        outside += len(p - on)
        sizes[len(on)] += 1
        if not 13 <= len(on) <= 18:
            odd.append((g.GAME_DATE, TEAM_ID_TO_ABBR[int(g.TEAM_ID)], len(on), len(p)))

    sources = collections.Counter(s.source for ss in stints.values() for s in ss)
    print(f"\nseason {season}: {len(teams) // 2} games, {len(stints)} players, stints by source {dict(sources)}")
    print(f"roster size per team-game: {dict(sorted(sizes.items()))}")
    print(f"played but outside any stint (must be 0): {outside}")
    print(f"team-games outside 13-18: {len(odd)}")
    for o in sorted(odd)[:40]:
        print("   ", o)
    print(f"unmatched feed players ({len(unmatched)}): {', '.join(sorted(p.slug for p in unmatched))}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", type=Path, default=None)
    asyncio.run(main(ap.parse_args().cache))

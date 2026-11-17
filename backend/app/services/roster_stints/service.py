"""Nightly rebuild of nba_roster_stints, and reads for the With / Without page.

The rebuild runs after the night's box scores are ingested (end of
ModelNightlyService.run_catchup) and once at startup when the season has no
stints yet. It replaces the whole season in one transaction; on any failure the
previous stints stay and the error shows on /health?verbose=1.
"""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from zoneinfo import ZoneInfo

import httpx

from app.config import settings
from app.services.db_service import DBService
from app.services.roster_stints.feed import FeedRow, FeedUnavailable, fetch_feed
from app.services.roster_stints.matching import EspnPlayer, FeedPlayer, match_players
from app.services.roster_stints.replay import Stint, build_stints, clip_to_season, feed_intervals, offseason_start
from model_stats_inference.espn import client as espn_client
from model_stats_inference.espn.games import season_for
from model_stats_inference.espn.teams import TEAM_IDS

logger = logging.getLogger(__name__)

EASTERN = ZoneInfo("America/New_York")


@dataclass
class RebuildStatus:
    last_attempt: str | None = None
    last_success: str | None = None
    season: str | None = None
    feed_rows: int = 0
    players: int = 0
    stints: int = 0
    approx_players: int = 0
    unmatched_feed_players: list[str] | None = None
    error: str | None = None


status = RebuildStatus()
_lock = asyncio.Lock()
# Filled by _fetch_espn_rosters: ESPN position per player, for players who
# haven't played yet.
roster_positions: dict[int, str] = {}


def eastern_today() -> date:
    return datetime.now(EASTERN).date()


def current_season() -> str:
    return season_for(eastern_today())


async def _fetch_espn_rosters() -> dict[int, tuple[str, int]]:
    """{espn_player_id: (name, team_id)} from ESPN's current team rosters (the
    position goes to `roster_positions`). Covers
    players who haven't appeared in a box score yet (hurt since opening night).
    A team that fails is skipped."""
    out: dict[int, tuple[str, int]] = {}
    sem = asyncio.Semaphore(6)

    async def one(client: httpx.AsyncClient, team_id: int) -> None:
        async with sem:
            try:
                data = await espn_client.async_get_json(client, f"teams/{team_id}/roster")
            except Exception as e:
                logger.warning(f"Roster stints: ESPN roster for team {team_id} unavailable: {type(e).__name__}: {e}")
                return
        for a in data.get("athletes", []):
            try:
                pid = int(a["id"])
            except (KeyError, TypeError, ValueError):
                continue
            out[pid] = (str(a.get("displayName", "")), team_id)
            roster_positions[pid] = str((a.get("position") or {}).get("abbreviation", ""))

    async with httpx.AsyncClient() as client:
        await asyncio.gather(*(one(client, t) for t in sorted(TEAM_IDS)))
    return out


def compute_stints(
    feed: list[FeedRow],
    appearances: list[tuple[int, str, int, date]],
    espn_rosters: dict[int, tuple[str, int]],
    season_start: date,
    today: date,
) -> tuple[dict[int, list[Stint]], list[FeedPlayer]]:
    """Pure core of the rebuild: ({espn_player_id: stints}, unmatched feed players)."""
    # ESPN players we know of this season, with every team they're tied to.
    espn: dict[int, EspnPlayer] = {}
    apps: dict[int, list[tuple[date, int]]] = defaultdict(list)
    for pid, name, team, day in appearances:
        p = espn.setdefault(pid, EspnPlayer(pid, name))
        p.teams.add(team)
        apps[pid].append((day, team))
    for pid, (name, team) in espn_rosters.items():
        p = espn.setdefault(pid, EspnPlayer(pid, name))
        p.teams.add(team)

    # Feed players whose history reaches into this season.
    rows_by_player: dict[int, list[FeedRow]] = defaultdict(list)
    for r in feed:
        rows_by_player[r.nba_player_id].append(r)
    relevant: list[FeedPlayer] = []
    for nba_id, rows in rows_by_player.items():
        season = clip_to_season(feed_intervals(rows, today), season_start, today)
        if season:
            relevant.append(FeedPlayer(nba_id, rows[-1].player_slug, {s.team_id for s in season}))

    matched, unmatched = match_players(relevant, list(espn.values()))
    feed_for_espn = {espn_id: rows_by_player[nba_id] for nba_id, espn_id in matched.items()}

    # Retired players never get a closing row, so only an unmatched player who
    # moved since July 1 is worth reporting.
    july1 = offseason_start(season_start)
    unmatched = [p for p in unmatched if rows_by_player[p.nba_player_id][-1].day >= july1]

    out: dict[int, list[Stint]] = {}
    for pid in set(espn) | set(feed_for_espn):
        current = espn_rosters.get(pid, (None, None))[1]
        stints = build_stints(feed_for_espn.get(pid, []), apps.get(pid, []), season_start, today, current)
        if stints:
            out[pid] = stints
    return out, unmatched


class RosterStintsService:
    def __init__(self, db: DBService | None = None):
        self.db = db or DBService()

    async def _season_start(self, season: str) -> date:
        pool = await self.db._get_pool()
        if pool is not None:
            async with pool.acquire() as conn:
                d = await conn.fetchval("SELECT MIN(game_date) FROM fs_team_games WHERE season = $1", season)
            if d:
                return d
        return settings.season_start

    async def _appearances(self, season: str) -> list[tuple[int, str, int, date]]:
        pool = await self.db._get_pool()
        if pool is None:
            return []
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT player_id, player_name, team_id, game_date, position FROM fs_player_games "
                "WHERE season = $1 ORDER BY game_date",
                season,
            )
        self._positions = {int(r["player_id"]): r["position"] for r in rows if r["position"]}
        return [(int(r["player_id"]), r["player_name"], int(r["team_id"]), r["game_date"]) for r in rows]

    async def _write(
        self, season: str, stints: dict[int, list[Stint]], names: dict[int, str], positions: dict[int, str],
    ) -> int:
        pool = await self.db._get_pool()
        if pool is None:
            raise RuntimeError("database unavailable")
        records = [
            (season, pid, names.get(pid, ""), positions.get(pid, ""), s.team_id, s.start, s.end, s.two_way, s.source)
            for pid, ss in stints.items() for s in ss
        ]
        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute("DELETE FROM nba_roster_stints WHERE season = $1", season)
                await conn.copy_records_to_table(
                    "nba_roster_stints",
                    records=records,
                    columns=["season", "player_id", "player_name", "position", "team_id",
                             "start_date", "end_date", "two_way", "source"],
                )
        return len(records)

    async def has_season(self, season: str) -> bool:
        pool = await self.db._get_pool()
        if pool is None:
            return False
        async with pool.acquire() as conn:
            return bool(await conn.fetchval(
                "SELECT EXISTS (SELECT 1 FROM nba_roster_stints WHERE season = $1)", season,
            ))

    async def rebuild(self) -> RebuildStatus:
        """Rebuild this season's stints. Never raises; the outcome is in `status`."""
        async with _lock:
            status.last_attempt = datetime.now(EASTERN).isoformat(timespec="seconds")
            try:
                today = eastern_today()
                season = current_season()
                feed, appearances, rosters, season_start = await asyncio.gather(
                    fetch_feed(), self._appearances(season), _fetch_espn_rosters(), self._season_start(season),
                )
                stints, unmatched = compute_stints(feed, appearances, rosters, season_start, today)
                names = {pid: name for pid, (name, _) in rosters.items()}
                names.update({pid: name for pid, name, _, _ in appearances})   # latest box name wins
                positions = {**roster_positions, **getattr(self, "_positions", {})}
                written = await self._write(season, stints, names, positions)
            except (FeedUnavailable, Exception) as e:
                status.error = f"{type(e).__name__}: {e}"
                logger.error(f"Roster stints rebuild failed, keeping the previous stints: {status.error}")
                return status
            approx = sum(1 for ss in stints.values() if any(s.source in ("box", "box_only") for s in ss))
            status.last_success = status.last_attempt
            status.season = season
            status.feed_rows = len(feed)
            status.players = len(stints)
            status.stints = written
            status.approx_players = approx
            status.unmatched_feed_players = sorted(p.slug for p in unmatched)
            status.error = None
            logger.info(
                f"Roster stints {season}: {written} stints for {len(stints)} players "
                f"({approx} approximate, {len(unmatched)} feed players unmatched)"
            )
            if unmatched:
                logger.info(f"Roster stints: unmatched feed players: {', '.join(status.unmatched_feed_players[:40])}")
            return status

    async def rebuild_if_empty(self) -> None:
        try:
            if not await self.has_season(current_season()):
                await self.rebuild()
        except Exception as e:
            logger.warning(f"Roster stints startup check failed: {type(e).__name__}: {e}")

    async def team_stints(self, season: str, team_id: int) -> list[dict]:
        pool = await self.db._get_pool()
        if pool is None:
            return []
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT player_id, player_name, position, start_date, end_date, two_way, source "
                "FROM nba_roster_stints "
                "WHERE season = $1 AND team_id = $2",
                season, team_id,
            )
        return [dict(r) for r in rows]


def health() -> dict:
    return {
        "ok": status.error is None and status.last_success is not None,
        "last_attempt": status.last_attempt,
        "last_success": status.last_success,
        "season": status.season,
        "feed_rows": status.feed_rows,
        "players": status.players,
        "stints": status.stints,
        "approx_players": status.approx_players,
        "unmatched_feed_players": len(status.unmatched_feed_players or []),
        "error": status.error,
    }

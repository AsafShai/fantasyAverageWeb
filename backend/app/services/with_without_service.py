"""Data for the With / Without page: one NBA team's season, game by game.

The page does every split and calculation in the browser (which games count as
"with" or "without" depends on which players the viewer picks), so this sends
the raw material once per team:

  - the team's games, in date order
  - every player who was on the team at any point this season, with one entry
    per game: null = not on the team that day, 0 = on the team and sat,
    [stats...] = played (any minutes count)
  - current fantasy owner and today's injury status per player
  - the league's categories, so the page scores exactly what the league counts
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import defaultdict
from datetime import date

from app.services.box_score_value_service import _fantasy_teams, _league_categories, _roster_on
from app.services.db_service import DBService
from app.services.roster_stints import service as stints_service
from app.services.roster_stints.matching import name_tokens
from app.services.roster_stints.service import RosterStintsService, current_season, eastern_today
from app.services import injury_service
from model_stats_inference.espn.teams import TEAM_ID_TO_ABBR, TEAM_ID_TO_NAME, TEAM_IDS

logger = logging.getLogger(__name__)

# Order of the numbers in a played game's entry. USG% is Dean Oliver's usage
# rate for that game, the same formula Trends averages (never from summed totals).
LINE_FIELDS = ["MIN", "PTS", "REB", "AST", "STL", "BLK", "3PM", "FGM", "FGA", "FTM", "FTA", "TO", "3PA", "OREB", "DREB", "PF", "USG%"]
_COLUMNS = ["min", "pts", "reb", "ast", "stl", "blk", "fg3m", "fgm", "fga", "ftm", "fta", "tov", "fg3a", "oreb", "dreb", "pf"]
_APPROX_SOURCES = {"box", "box_only"}
CACHE_TTL = 30 * 60

_cache: dict[tuple, tuple[float, dict]] = {}


class UnknownTeam(Exception):
    pass


def clear_cache() -> None:
    _cache.clear()


def _key(name: str) -> str:
    return "".join(name_tokens(name))


def out_today_by_team() -> dict[int, dict[str, dict]]:
    """{espn_team_id: {name_key: {status, note}}} for players listed Out on the
    current official injury report."""
    name_to_team = {name.lower(): tid for tid, name in TEAM_ID_TO_NAME.items()}
    out: dict[int, dict[str, dict]] = defaultdict(dict)
    for rec in injury_service.injury_store.values():
        if rec.status != "Out":
            continue
        tid = name_to_team.get(rec.team.lower())
        if tid is None:
            continue
        out[tid][_key(rec.player)] = {"status": rec.status, "note": rec.injury}
    return out


def teams_payload() -> dict:
    outs = out_today_by_team()
    return {
        "teams": [
            {"team_id": tid, "abbr": TEAM_ID_TO_ABBR[tid], "name": TEAM_ID_TO_NAME[tid], "has_out_today": bool(outs.get(tid))}
            for tid in sorted(TEAM_IDS, key=lambda t: TEAM_ID_TO_NAME[t])
        ]
    }


def _covers(stint: dict, d: date) -> bool:
    return stint["start_date"] <= d and (stint["end_date"] is None or d <= stint["end_date"])


def usage_pct(p_fga: float, p_fta: float, p_tov: float, p_min: float, t_fga: float, t_fta: float, t_tov: float, t_min: float) -> float:
    """One game's USG%, matching Trends: 100 * (FGA + 0.44*FTA + TOV) * (team minutes / 5) / (minutes * team possessions)."""
    denom = p_min * (t_fga + 0.44 * t_fta + t_tov)
    if denom == 0:
        return 0.0
    return 100 * (p_fga + 0.44 * p_fta + p_tov) * (t_min / 5) / denom


def build_team_payload(
    team_id: int,
    season: str,
    games: list[dict],
    rows: list[dict],
    stints: list[dict],
    owners: dict[int, dict | None],
    outs: dict[str, dict],
    categories: list[str],
    reverse: list[str],
) -> dict:
    """Pure: assemble the page payload from the queried rows."""
    by_player_stints: dict[int, list[dict]] = defaultdict(list)
    for s in stints:
        by_player_stints[int(s["player_id"])].append(s)
    lines: dict[int, dict[str, dict]] = defaultdict(dict)
    meta: dict[int, dict] = {}
    team_min: dict[str, float] = defaultdict(float)
    for r in rows:
        pid = int(r["player_id"])
        lines[pid][r["game_id"]] = r
        meta[pid] = {"name": r["player_name"], "pos": r["position"]}
        team_min[r["game_id"]] += float(r["min"] or 0)
    for pid, ss in by_player_stints.items():
        if pid not in meta or not meta[pid]["name"]:
            meta[pid] = {"name": ss[0].get("player_name") or str(pid), "pos": ss[0].get("position") or ""}

    players = []
    for pid in sorted(set(by_player_stints) | set(lines)):
        ss = by_player_stints.get(pid, [])
        entries: list = []
        for g in games:
            r = lines[pid].get(g["game_id"])
            if r is not None and (r["min"] or 0) > 0:
                usg = usage_pct(
                    float(r.get("fga") or 0), float(r.get("fta") or 0), float(r.get("tov") or 0), float(r["min"] or 0),
                    float(r.get("t_fga") or 0), float(r.get("t_fta") or 0), float(r.get("t_tov") or 0),
                    team_min[g["game_id"]],
                )
                entries.append([round(float(r[c] or 0), 1) for c in _COLUMNS] + [round(usg, 1)])
            elif r is not None or any(_covers(s, g["date_obj"]) for s in ss):
                entries.append(0)
            else:
                entries.append(None)
        if all(e is None for e in entries):
            continue
        latest = max(ss, key=lambda s: s["start_date"]) if ss else None
        name = meta[pid]["name"]
        players.append({
            "player_id": pid,
            "name": name,
            "pos": meta[pid]["pos"],
            "two_way": bool(latest and latest["two_way"]),
            "approx": any(s["source"] in _APPROX_SOURCES for s in ss) or not ss,
            "out_today": outs.get(_key(name)),
            "owner": owners.get(pid),
            "lines": entries,
        })

    return {
        "team_id": team_id,
        "abbr": TEAM_ID_TO_ABBR.get(team_id, ""),
        "name": TEAM_ID_TO_NAME.get(team_id, ""),
        "season": season,
        "categories": categories,
        "reverse_categories": reverse,
        "line_fields": LINE_FIELDS,
        "games": [{k: v for k, v in g.items() if k != "date_obj"} for g in games],
        "players": players,
    }


async def _query(team_id: int, season: str) -> tuple[list[dict], list[dict]]:
    pool = await DBService()._get_pool()
    if pool is None:
        return [], []
    async with pool.acquire() as conn:
        game_rows = await conn.fetch(
            """
            SELECT a.game_id, a.game_date, a.matchup, a.pts AS pts, b.pts AS opp_pts, b.team_id AS opp_id
            FROM fs_team_games a
            JOIN fs_team_games b ON b.game_id = a.game_id AND b.team_id <> a.team_id
            WHERE a.season = $1 AND a.team_id = $2
            ORDER BY a.game_date, a.game_id
            """,
            season, team_id,
        )
        rows = await conn.fetch(
            f"""
            SELECT p.player_id, p.player_name, p.position, p.game_id, {', '.join(f'p.{c}' for c in _COLUMNS)},
                   t.fga AS t_fga, t.fta AS t_fta, t.tov AS t_tov
            FROM fs_player_games p
            LEFT JOIN fs_team_games t ON t.team_id = p.team_id AND t.game_id = p.game_id
            WHERE p.season = $1 AND p.team_id = $2
            """,
            season, team_id,
        )
    games = []
    for g in game_rows:
        pts, opp = int(g["pts"]), int(g["opp_pts"])
        games.append({
            "game_id": g["game_id"],
            "date": g["game_date"].isoformat(),
            "date_obj": g["game_date"],
            "opp": TEAM_ID_TO_ABBR.get(int(g["opp_id"]), ""),
            "home": " vs. " in (g["matchup"] or ""),
            "result": f"{'W' if pts > opp else 'L'} {max(pts, opp)}-{min(pts, opp)}",
        })
    return games, [dict(r) for r in rows]


async def _owners() -> dict[int, dict | None]:
    try:
        roster, (abbrevs, names) = await asyncio.gather(_roster_on(eastern_today()), _fantasy_teams())
    except Exception as e:
        logger.warning(f"With/Without: fantasy rosters unavailable: {type(e).__name__}: {e}")
        return {}
    out: dict[int, dict | None] = {}
    for pid, owner in roster.items():
        tid = owner.get("team_id")
        if tid is None:
            continue
        out[int(pid)] = {"team_id": tid, "abbrev": abbrevs.get(tid, str(tid)), "name": names.get(tid) or abbrevs.get(tid, str(tid))}
    return out


async def team_payload(team_id: int) -> dict:
    if team_id not in TEAM_IDS:
        raise UnknownTeam(team_id)
    season = current_season()
    key = (season, team_id, stints_service.status.last_success)
    hit = _cache.get(key)
    if hit is not None and time.monotonic() < hit[0]:
        return hit[1]
    (games, rows), stints, owners, (categories, reverse) = await asyncio.gather(
        _query(team_id, season),
        RosterStintsService().team_stints(season, team_id),
        _owners(),
        _league_categories(),
    )
    payload = build_team_payload(
        team_id, season, games, rows, stints, owners, out_today_by_team().get(team_id, {}),
        list(categories), [c for c in categories if c in reverse],
    )
    _cache[key] = (time.monotonic() + CACHE_TTL, payload)
    return payload

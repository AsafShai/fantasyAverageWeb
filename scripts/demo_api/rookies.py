"""Rookies for the demo slate.

The underlying season predates the current rookie class, so they have no game
history and the model has nothing to fit. These entries are the one genuinely
invented part of the demo: real 2026-27 rookies with projections built from a
veteran archetype at the same position.
"""
from __future__ import annotations

import random

ROOKIES = [
    ("AJ Dybantsa", ["SF"], 30.5, "wing-scorer"),
    ("Darryn Peterson", ["PG", "SG"], 31.0, "lead-guard"),
    ("Cameron Boozer", ["PF"], 29.0, "big"),
    ("Nate Ament", ["SF", "PF"], 26.5, "wing-scorer"),
    ("Darius Acuff Jr.", ["PG"], 24.0, "lead-guard"),
    ("Koa Peat", ["PF"], 22.5, "big"),
    ("Chris Cenac Jr.", ["C"], 21.0, "big"),
    ("Mikel Brown Jr.", ["PG"], 23.5, "lead-guard"),
    ("Tounde Yessoufou", ["SG", "SF"], 20.0, "wing-scorer"),
    ("Caleb Wilson", ["PF", "C"], 22.0, "big"),
]

ARCHETYPES = {
    "lead-guard": {"pts": 0.62, "reb": 0.11, "ast": 0.19, "three_pm": 0.07, "stl": 0.038,
                   "blk": 0.008, "fga": 0.47, "fg_pct": 0.435, "fta": 0.14, "ft_pct": 0.80},
    "wing-scorer": {"pts": 0.66, "reb": 0.16, "ast": 0.09, "three_pm": 0.08, "stl": 0.035,
                    "blk": 0.020, "fga": 0.50, "fg_pct": 0.455, "fta": 0.15, "ft_pct": 0.77},
    "big": {"pts": 0.55, "reb": 0.28, "ast": 0.07, "three_pm": 0.02, "stl": 0.025,
            "blk": 0.055, "fga": 0.39, "fg_pct": 0.525, "fta": 0.16, "ft_pct": 0.69},
}


def _projection(minutes: float, archetype: str, rng: random.Random) -> dict:
    a = ARCHETYPES[archetype]
    jitter = lambda v, pct=0.10: round(v * rng.uniform(1 - pct, 1 + pct), 2)
    fga = jitter(a["fga"] * minutes)
    fg_pct = round(min(0.62, max(0.38, rng.gauss(a["fg_pct"], 0.02))), 3)
    fgm = round(fga * fg_pct, 1)
    fta = jitter(a["fta"] * minutes)
    ft_pct = round(min(0.92, max(0.60, rng.gauss(a["ft_pct"], 0.03))), 3)
    ftm = round(fta * ft_pct, 1)
    three = jitter(a["three_pm"] * minutes)
    return {
        "pts": round(2 * (fgm - three) + 3 * three + ftm, 1),
        "reb": jitter(a["reb"] * minutes),
        "ast": jitter(a["ast"] * minutes),
        "three_pm": three,
        "stl": jitter(a["stl"] * minutes),
        "blk": jitter(a["blk"] * minutes),
        "fgm": fgm, "fga": fga, "fg_pct": fg_pct,
        "ftm": ftm, "fta": fta, "ft_pct": ft_pct,
    }


BASE_ID = 9900000

TEAM_NAMES: dict[str, str] = {}


ABBR_FIXES = {"WSH": "WAS", "UTAH": "UTA", "PHX": "PHO", "NO": "NOP", "NY": "NYK",
              "SA": "SAS", "GS": "GSW", "PHI": "PHL", "NOR": "NOP"}


def assign_teams(roster: dict[str, str], team_names: dict[str, str]) -> None:
    """Place rookies on the team whose real depth chart lists them."""
    TEAM_NAMES.update({ABBR_FIXES.get(k, k): v for k, v in team_names.items()})
    for pid, r in list(PLAYERS.items()):
        abbr = roster.get(r["player_name"].lower())
        if abbr:
            r["pro_team"] = ABBR_FIXES.get(abbr, abbr)
        else:
            PLAYERS.pop(pid)


def _build() -> dict[int, dict]:
    rng = random.Random(2027)
    out: dict[int, dict] = {}
    for i, (name, positions, minutes, archetype) in enumerate(ROOKIES, start=1):
        team = "FA"
        pid = BASE_ID + i
        gp = rng.randint(14, 19)
        proj = _projection(minutes, archetype, rng)
        totals = {
            "pts": round(proj["pts"] * gp), "reb": round(proj["reb"] * gp),
            "ast": round(proj["ast"] * gp), "stl": round(proj["stl"] * gp),
            "blk": round(proj["blk"] * gp), "fgm": round(proj["fgm"] * gp),
            "fga": round(proj["fga"] * gp), "ftm": round(proj["ftm"] * gp),
            "fta": round(proj["fta"] * gp), "three_pm": round(proj["three_pm"] * gp),
            "minutes": round(minutes * gp, 1), "gp": gp,
        }
        totals["fg_percentage"] = round(totals["fgm"] / totals["fga"], 4) if totals["fga"] else 0.0
        totals["ft_percentage"] = round(totals["ftm"] / totals["fta"], 4) if totals["fta"] else 0.0
        out[pid] = {
            "player_id": pid, "player_name": name, "pro_team": team, "positions": positions,
            "minutes": minutes, "projection": proj, "totals": totals, "gp": gp,
        }
    return out


PLAYERS: dict[int, dict] = _build()


def player_rows() -> list[dict]:
    return [{
        "player_name": r["player_name"], "pro_team": r["pro_team"], "positions": r["positions"],
        "stats": r["totals"], "team_id": 0, "status": "FREEAGENT", "player_id": r["player_id"],
        "injured": False, "fantasy_team_name": None,
        "season_rating": None, "last7_rating": None, "last15_rating": None, "last30_rating": None,
        "has_data": True,
    } for r in PLAYERS.values()]


def bio(player_id: int) -> dict | None:
    r = PLAYERS.get(player_id)
    if not r:
        return None
    return {
        "id": f"demo-{player_id}", "display_name": r["player_name"],
        "team": TEAM_NAMES.get(r["pro_team"], r["pro_team"]), "team_abbr": r["pro_team"],
        "conference": "", "division": "", "position": "/".join(r["positions"]),
        "photo_url": None, "height": None, "nationality": None, "age": 19,
        "jersey_number": None,
    }


def stats(player_id: int) -> dict | None:
    r = PLAYERS.get(player_id)
    if not r:
        return None
    gp = r["gp"]
    totals = r["totals"]
    averages = {k: (round(v / gp, 2) if k not in ("gp", "fg_percentage", "ft_percentage") else v)
                for k, v in totals.items()}
    return {"player_id": player_id, "totals": totals, "averages": averages, "has_data": True}


def next_game(player_id: int, opponent: str, game_date: str) -> dict | None:
    r = PLAYERS.get(player_id)
    if not r:
        return None
    return {
        "player_name": r["player_name"], "team": r["pro_team"], "game_date": game_date,
        "opponent": opponent, "is_home": True, "scheduled": True,
        "default_minutes": r["minutes"], "status": "green",
        "reason": f"model fit on {r['gp']} games this season", "stats": r["projection"],
    }


def slate_entries(slate: list[dict], game_date: str) -> list[dict]:
    """Rookie rows for teams already on the slate, so opponent context is real."""
    by_team: dict[str, dict] = {}
    for m in slate:
        by_team.setdefault(m["pro_team"], m)

    out = []
    for r in PLAYERS.values():
        name, team, positions = r["player_name"], r["pro_team"], r["positions"]
        ref = by_team.get(team)
        if not ref:
            continue
        out.append({
            "player_name": name,
            "pro_team": team,
            "opponent": ref["opponent"],
            "is_home": ref["is_home"],
            "pace": ref["pace"],
            "league_avg_pace": ref["league_avg_pace"],
            "positions": positions,
            "def_ranks": ref["def_ranks"],
            "def_values": ref["def_values"],
            "league_avg_def_values": ref["league_avg_def_values"],
            "projection": {
                "default_minutes": r["minutes"],
                "status": "green",
                "reason": f"model fit on {r['gp']} games this season",
                "stats": r["projection"],
            },
            "game_date": game_date,
            "on_depth_chart": True,
            "injury_status": None,
        })
    return out

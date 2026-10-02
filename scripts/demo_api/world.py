"""Deterministic simulated season used by the demo API.

Real snapshot data (player names/ids/teams, model projections, depth charts,
minigame bundle) is the skeleton; game logs and everything derived from them
are generated so the offseason app looks like a live mid-January league.
"""
from __future__ import annotations

import json
import math
import random
from datetime import date, timedelta
from pathlib import Path
from typing import Any

SNAP = Path(__file__).parent / "snapshots"

SEASON_START = date(2026, 10, 20)
TODAY = date(2027, 1, 13)
SEASON_LABEL = "2026-27"
SEED = 20260114

RANKING_CATEGORIES = ["FG%", "FT%", "3PM", "AST", "REB", "STL", "BLK", "PTS"]
SLOT_CAPS = {"PG": 82, "SG": 82, "SF": 82, "PF": 82, "C": 82, "G": 82, "F": 82, "UTIL": 248}

TEAM_NAMES: dict[int, str] = {
    t["team_id"]: t["team_name"]
    for t in json.loads((SNAP / "fantasy_teams.json").read_text(encoding="utf-8"))
}

ROSTER_SIZE = 13

LEADERBOARD_NAMES = [
    "Asaf", "Yotam", "Omri", "Ronen", "Nadav", "Tal", "Guy", "Ido", "Shai", "Eran",
]

INJURY_SAMPLES = [
    ("Anthony Davis", "DAL", "Out", "Left Adductor; Strain"),
    ("Jayson Tatum", "BOS", "Questionable", "Right Ankle; Sprain"),
    ("Ja Morant", "MEM", "Probable", "Right Hip; Soreness"),
    ("Zion Williamson", "NOP", "Out", "Left Hamstring; Strain"),
    ("Kawhi Leonard", "LAC", "Questionable", "Injury Management"),
    ("Joel Embiid", "PHL", "Doubtful", "Left Knee; Swelling"),
    ("Paolo Banchero", "ORL", "Probable", "Right Wrist; Soreness"),
    ("Dejounte Murray", "NOP", "Out", "Right Hand; Fracture"),
]


def _load(name: str) -> Any:
    return json.loads((SNAP / f"{name}.json").read_text(encoding="utf-8"))


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


class World:
    def __init__(self) -> None:
        self.rng = random.Random(SEED)
        self.nba_teams = _load("nba_teams")
        self.depth_charts = _load("depth_charts")
        self.minigame_players = _load("minigame_players")
        self.matchups_raw = _load("matchups_today")
        self.fs_players = _load("fs_players")
        self.fs_teams = _load("fs_teams")
        self.bios = _load("bios")
        self.projections = _load("projections")
        self.pool_raw = _load("player_pool")

        self.abbrs = [t["abbreviation"] for t in self.nba_teams]
        self._build_players()
        self._build_schedule()
        self._build_trend_scripts()
        self._build_game_logs()
        self._build_rosters()
        self._build_def_profiles()

    # ---------- players ----------

    def _build_players(self) -> None:
        by_id = {}
        for p in self.pool_raw:
            pid = p.get("player_id")
            if pid:
                by_id.setdefault(str(pid), p)

        self.players: dict[str, dict] = {}
        for pid, proj in self.projections.items():
            base = by_id.get(pid)
            stats = proj.get("stats")
            if not base or not stats or not proj.get("default_minutes"):
                continue
            self.players[pid] = {
                "player_id": int(pid),
                "player_name": proj["player_name"],
                "pro_team": proj.get("team") or base.get("pro_team") or "FA",
                "positions": base.get("positions") or ["UTIL"],
                "minutes": float(proj["default_minutes"]),
                "proj": stats,
                "value": self._value(stats),
            }

    @staticmethod
    def _value(s: dict) -> float:
        return (
            s["pts"] / 9.0 + s["reb"] / 4.5 + s["ast"] / 3.5 + s["three_pm"] / 1.4
            + s["stl"] * 1.5 + s["blk"] * 1.5 + (s["fg_pct"] - 0.46) * 12
            + (s["ft_pct"] - 0.78) * 4
        )

    # ---------- schedule ----------

    def _build_schedule(self) -> None:
        self.team_games: dict[str, list[tuple[date, str, bool]]] = {a: [] for a in self.abbrs}
        d = SEASON_START
        while d < TODAY:
            teams = self.abbrs[:]
            self.rng.shuffle(teams)
            playing = teams[: 2 * self.rng.randint(3, 11)]
            for i in range(0, len(playing), 2):
                home, away = playing[i], playing[i + 1]
                self.team_games[home].append((d, away, True))
                self.team_games[away].append((d, home, False))
            d += timedelta(days=1)
        self.nba_avg_gp = round(sum(len(g) for g in self.team_games.values()) / 30, 1)

    # ---------- trend scripts ----------

    def _build_trend_scripts(self) -> None:
        ids = sorted(self.players, key=lambda p: -self.players[p]["value"])
        pool = ids[:260]
        picked = self.rng.sample(pool, 120)
        self.scripts: dict[str, dict] = {}
        for i, pid in enumerate(picked):
            if i < 26:
                self.scripts[pid] = {"min": self.rng.uniform(0.22, 0.48), "usg": self.rng.uniform(0.04, 0.16)}
            elif i < 48:
                self.scripts[pid] = {"min": -self.rng.uniform(0.18, 0.40), "usg": -self.rng.uniform(0.03, 0.14)}
            elif i < 70:
                self.scripts[pid] = {"min": self.rng.uniform(-0.05, 0.05), "usg": self.rng.uniform(0.06, 0.15)}
            elif i < 92:
                self.scripts[pid] = {"min": 0.0, "usg": 0.0, "hot3": self.rng.uniform(0.07, 0.16)}
            else:
                self.scripts[pid] = {"min": 0.0, "usg": 0.0, "hot3": -self.rng.uniform(0.06, 0.14)}

    # ---------- game logs ----------

    def _build_game_logs(self) -> None:
        window_start = TODAY - timedelta(days=15)
        self.logs: dict[str, list[dict]] = {}
        for pid, p in self.players.items():
            script = self.scripts.get(pid, {})
            games = self.team_games.get(p["pro_team"], [])
            rest_rate = 0.06 if p["value"] > 6 else 0.14
            rows = []
            for gdate, opp, is_home in games:
                if self.rng.random() < rest_rate:
                    continue
                in_window = gdate >= window_start
                mfac = 1.0 + (script.get("min", 0.0) if in_window else 0.0)
                ufac = 1.0 + (script.get("usg", 0.0) if in_window else 0.0)
                hot3 = script.get("hot3", 0.0) if in_window else 0.0
                rows.append(self._game(p, gdate, opp, is_home, mfac, ufac, hot3))
            self.logs[pid] = rows

    def _game(self, p: dict, gdate: date, opp: str, is_home: bool, mfac: float, ufac: float, hot3: float) -> dict:
        s = p["proj"]
        base_min = p["minutes"] * mfac
        minutes = _clamp(self.rng.gauss(base_min, base_min * 0.11), 6.0, 44.0)
        k = (minutes / p["minutes"]) * ufac

        def cnt(mean: float) -> int:
            lam = max(0.0, mean * k)
            if lam <= 0:
                return 0
            n, limit, prod = 0, math.exp(-lam), 1.0
            while True:
                prod *= self.rng.random()
                if prod <= limit:
                    return n
                n += 1

        fga = cnt(s["fga"])
        fg3a = min(fga, cnt(max(s["three_pm"] * 2.6, 0.2)))
        fg3_pct = _clamp(self.rng.gauss(0.36 + hot3, 0.13), 0.0, 1.0)
        fg3m = sum(1 for _ in range(fg3a) if self.rng.random() < fg3_pct)
        two_a = fga - fg3a
        two_pct = _clamp(self.rng.gauss(s["fg_pct"] + 0.06, 0.12), 0.05, 0.95)
        two_m = sum(1 for _ in range(two_a) if self.rng.random() < two_pct)
        fgm = two_m + fg3m
        fta = cnt(s["fta"])
        ft_pct = _clamp(self.rng.gauss(s["ft_pct"], 0.14), 0.0, 1.0)
        ftm = sum(1 for _ in range(fta) if self.rng.random() < ft_pct)
        ast, reb, stl, blk = cnt(s["ast"]), cnt(s["reb"]), cnt(s["stl"]), cnt(s["blk"])
        pts = 2 * two_m + 3 * fg3m + ftm
        usg = _clamp(100.0 * (fga + 0.44 * fta + 0.35 * ast) / max(minutes * 2.05, 1.0), 6.0, 42.0)

        return {
            "game_date": gdate.isoformat(),
            "matchup": f"{p['pro_team']} {'vs' if is_home else '@'} {opp}",
            "min": round(minutes, 1),
            "usg": round(usg, 1),
            "fgm": fgm, "fga": fga, "ftm": ftm, "fta": fta,
            "fg3m": fg3m, "fg3a": fg3a,
            "pts": pts, "reb": reb, "ast": ast, "stl": stl, "blk": blk,
        }

    # ---------- rosters ----------

    def _build_rosters(self) -> None:
        order = sorted(self.players, key=lambda p: -self.players[p]["value"])
        team_ids = list(TEAM_NAMES)
        self.rosters: dict[int, list[str]] = {t: [] for t in team_ids}
        self.picks: list[dict] = []
        pick_no = 0
        idx = 0
        for rnd in range(1, ROSTER_SIZE + 1):
            seq = team_ids if rnd % 2 == 1 else team_ids[::-1]
            for tid in seq:
                if idx >= len(order):
                    break
                pid = order[idx]
                idx += 1
                pick_no += 1
                self.rosters[tid].append(pid)
                self.picks.append({
                    "pick": pick_no,
                    "round": rnd,
                    "team_id": tid,
                    "team_name": TEAM_NAMES[tid],
                    "player_name": self.players[pid]["player_name"],
                })
        self.owner: dict[str, int] = {p: t for t, ps in self.rosters.items() for p in ps}

    # ---------- defense profiles ----------

    def _build_def_profiles(self) -> None:
        cats = ["pts", "reb", "ast", "stl", "blk", "three_pm", "fg_pct"]
        centers = {"pts": 113.0, "reb": 43.5, "ast": 26.5, "stl": 7.8, "blk": 4.9, "three_pm": 13.2, "fg_pct": 0.472}
        spreads = {"pts": 6.0, "reb": 2.6, "ast": 2.4, "stl": 0.8, "blk": 0.7, "three_pm": 1.6, "fg_pct": 0.018}
        raw = {a: {c: self.rng.gauss(centers[c], spreads[c]) for c in cats} for a in self.abbrs}
        self.def_values = {a: {c: round(v, 3 if c == "fg_pct" else 1) for c, v in d.items()} for a, d in raw.items()}
        self.def_ranks: dict[str, dict[str, int]] = {a: {} for a in self.abbrs}
        for c in cats:
            for rank, a in enumerate(sorted(self.abbrs, key=lambda x: raw[x][c]), start=1):
                self.def_ranks[a][c] = rank
        self.league_avg_def = {c: round(sum(raw[a][c] for a in self.abbrs) / 30, 3 if c == "fg_pct" else 1) for c in cats}
        self.pace = {a: round(self.rng.gauss(99.5, 3.2), 1) for a in self.abbrs}
        self.league_avg_pace = round(sum(self.pace.values()) / 30, 1)

    # ---------- aggregation ----------

    def window(self, time_period: str = "season", start: str | None = None, end: str | None = None) -> tuple[date, date]:
        if time_period == "custom" and start and end:
            return date.fromisoformat(start), date.fromisoformat(end)
        days = {"last_7": 7, "last_15": 15, "last_30": 30}.get(time_period)
        if days:
            return TODAY - timedelta(days=days), TODAY
        return SEASON_START, TODAY

    def player_logs(self, pid: str, lo: date, hi: date) -> list[dict]:
        return [g for g in self.logs.get(pid, []) if lo <= date.fromisoformat(g["game_date"]) <= hi]

    def player_totals(self, pid: str, lo: date, hi: date) -> dict:
        rows = self.player_logs(pid, lo, hi)
        agg = {k: 0.0 for k in ("pts", "reb", "ast", "stl", "blk", "fgm", "fga", "ftm", "fta", "three_pm", "minutes")}
        for g in rows:
            agg["pts"] += g["pts"]; agg["reb"] += g["reb"]; agg["ast"] += g["ast"]
            agg["stl"] += g["stl"]; agg["blk"] += g["blk"]; agg["fgm"] += g["fgm"]
            agg["fga"] += g["fga"]; agg["ftm"] += g["ftm"]; agg["fta"] += g["fta"]
            agg["three_pm"] += g["fg3m"]; agg["minutes"] += g["min"]
        agg["gp"] = len(rows)
        agg["fg_percentage"] = round(agg["fgm"] / agg["fga"], 3) if agg["fga"] else 0.0
        agg["ft_percentage"] = round(agg["ftm"] / agg["fta"], 3) if agg["fta"] else 0.0
        agg["minutes"] = round(agg["minutes"], 1)
        return agg

    @staticmethod
    def to_avg(t: dict) -> dict:
        gp = t["gp"] or 1
        out = {k: round(t[k] / gp, 1) for k in ("pts", "reb", "ast", "stl", "blk", "fgm", "fga", "ftm", "fta", "three_pm", "minutes")}
        out["gp"] = t["gp"]
        out["fg_percentage"] = t["fg_percentage"]
        out["ft_percentage"] = t["ft_percentage"]
        return out

    def team_totals(self, tid: int, lo: date, hi: date) -> dict:
        acc = {k: 0.0 for k in ("pts", "reb", "ast", "stl", "blk", "fgm", "fga", "ftm", "fta", "three_pm", "gp")}
        for pid in self.rosters[tid]:
            t = self.player_totals(pid, lo, hi)
            for k in acc:
                acc[k] += t[k]
        acc["fg_percentage"] = round(acc["fgm"] / acc["fga"], 3) if acc["fga"] else 0.0
        acc["ft_percentage"] = round(acc["ftm"] / acc["fta"], 3) if acc["fta"] else 0.0
        acc["gp"] = int(acc["gp"])
        return acc

    def category_frame(self, lo: date, hi: date) -> dict[int, dict]:
        return {tid: self.team_totals(tid, lo, hi) for tid in self.rosters}

    @staticmethod
    def cat_value(t: dict, cat: str, per_game: bool) -> float:
        if cat == "FG%":
            return t["fg_percentage"]
        if cat == "FT%":
            return t["ft_percentage"]
        key = {"3PM": "three_pm", "AST": "ast", "REB": "reb", "STL": "stl", "BLK": "blk", "PTS": "pts"}[cat]
        gp = t["gp"] or 1
        return round(t[key] / gp, 2) if per_game else t[key]

    def rank_table(self, lo: date, hi: date, per_game: bool) -> list[dict]:
        frame = self.category_frame(lo, hi)
        ranks: dict[int, dict[str, float]] = {tid: {} for tid in frame}
        for cat in RANKING_CATEGORIES:
            vals = sorted(frame, key=lambda t: -self.cat_value(frame[t], cat, per_game))
            for i, tid in enumerate(vals):
                ranks[tid][cat] = float(len(vals) - i)
        out = []
        for tid, r in ranks.items():
            total = sum(r.values())
            out.append({
                "team": {"team_id": tid, "team_name": TEAM_NAMES[tid]},
                "fg_percentage": r["FG%"], "ft_percentage": r["FT%"], "three_pm": r["3PM"],
                "ast": r["AST"], "reb": r["REB"], "stl": r["STL"], "blk": r["BLK"], "pts": r["PTS"],
                "gp": frame[tid]["gp"], "total_points": total,
            })
        out.sort(key=lambda x: -x["total_points"])
        for i, row in enumerate(out, start=1):
            row["rank"] = i
        return out


WORLD = World()

"""Trends computed from the real box-score table at a chosen mid-season anchor.

The live trends endpoints anchor on the latest game date in the DB (end of the
2025-26 season), which is not what the demo wants to show. Same data, same
response shapes — only the anchor moves.
"""
from __future__ import annotations

import os
from datetime import date, timedelta

import psycopg
from psycopg.rows import dict_row

SEASON = "2025-26"
BASELINE_SEASONS = ("2023-24", "2024-25")
LOW_SAMPLE_GP = 3

PRO_TEAM_MAP = {
    0: "FA", 1: "ATL", 2: "BOS", 3: "NOP", 4: "CHI", 5: "CLE", 6: "DAL", 7: "DEN",
    8: "DET", 9: "GSW", 10: "HOU", 11: "IND", 12: "LAC", 13: "LAL", 14: "MIA",
    15: "MIL", 16: "MIN", 17: "BKN", 18: "NYK", 19: "ORL", 20: "PHL", 21: "PHO",
    22: "POR", 23: "SAC", 24: "SAS", 25: "OKC", 26: "UTA", 27: "WAS", 28: "TOR",
    29: "MEM", 30: "CHA",
}


def _conn():
    return psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row)


def _fetch_games(anchor: date, seasons: tuple[str, ...]) -> list[dict]:
    sql = """
        select player_id, player_name, team_id, game_id, season, game_date, matchup,
               position, min, pts, reb, ast, stl, blk, tov, fgm, fga, ftm, fta, fg3m, fg3a
        from fs_player_games
        where season = any(%s) and (season <> %s or game_date <= %s)
        order by game_date
    """
    with _conn() as c:
        return c.execute(sql, (list(seasons), SEASON, anchor)).fetchall()


def _team_usage_denominator(rows: list[dict]) -> dict[tuple[str, int], dict]:
    agg: dict[tuple[str, int], dict] = {}
    for r in rows:
        key = (r["game_id"], r["team_id"])
        t = agg.setdefault(key, {"fga": 0.0, "fta": 0.0, "tov": 0.0, "min": 0.0})
        t["fga"] += r["fga"] or 0
        t["fta"] += r["fta"] or 0
        t["tov"] += r["tov"] or 0
        t["min"] += r["min"] or 0
    return agg


def _usg(r: dict, team: dict) -> float:
    mp = r["min"] or 0
    if mp <= 0 or team["min"] <= 0:
        return 0.0
    plays = (r["fga"] or 0) + 0.44 * (r["fta"] or 0) + (r["tov"] or 0)
    team_plays = team["fga"] + 0.44 * team["fta"] + team["tov"]
    if team_plays <= 0:
        return 0.0
    return 100.0 * plays * (team["min"] / 5.0) / (mp * team_plays)


class TrendsDemo:
    def __init__(self, anchor: date) -> None:
        self.anchor = anchor
        rows = _fetch_games(anchor, (SEASON,) + BASELINE_SEASONS)
        self.season_rows = [r for r in rows if r["season"] == SEASON]
        self.base_rows = [r for r in rows if r["season"] != SEASON]
        teams = _team_usage_denominator(self.season_rows)
        for r in self.season_rows:
            r["usg"] = _usg(r, teams[(r["game_id"], r["team_id"])])

        self.by_player: dict[int, list[dict]] = {}
        for r in self.season_rows:
            self.by_player.setdefault(r["player_id"], []).append(r)
        self.base_by_name: dict[str, list[dict]] = {}
        for r in self.base_rows:
            self.base_by_name.setdefault(r["player_name"], []).append(r)

        self.league = {
            "3P%": _pct(self.season_rows, "fg3m", "fg3a"),
            "FT%": _pct(self.season_rows, "ftm", "fta"),
            "FG%": _pct(self.season_rows, "fgm", "fga"),
        }
        self.league_usg = 20.0
        self.owners: dict[str, str] = {}

    def set_owners(self, owners: dict[str, str]) -> None:
        self.owners = owners

    def nba_games_per_team(self) -> float:
        played = {(r["team_id"], r["game_id"]) for r in self.season_rows}
        teams = {t for t, _ in played}
        return round(len(played) / max(len(teams), 1), 1)

    def _meta(self, games: list[dict]) -> dict:
        last = games[-1]
        return {
            "player_id": last["player_id"],
            "player_name": last["player_name"],
            "pro_team": PRO_TEAM_MAP.get(last["team_id"], "FA"),
            "position": last["position"] or "",
            "fantasy_status": self.owners.get(last["player_name"], "FA"),
        }

    def _split(self, games: list[dict], window_days: int):
        start = self.anchor - timedelta(days=window_days)
        window = [g for g in games if g["game_date"] > start]
        return window, window

    def minutes(self, window_days: int) -> dict:
        items = []
        for games in self.by_player.values():
            if not games:
                continue
            window, l5 = self._split(games, window_days)
            if not window:
                continue
            season_mpg = sum(g["min"] or 0 for g in games) / len(games)
            l5_mpg = sum(g["min"] or 0 for g in l5) / len(l5)
            items.append({
                **self._meta(games),
                "games_last_15d": len(window),
                "season_mpg": season_mpg,
                "l5_mpg": l5_mpg,
                "delta_mpg": l5_mpg - season_mpg,
                "season_gp": len(games),
                "window_gp": len(window),
                "low_sample": len(window) < LOW_SAMPLE_GP,
            })
        items.sort(key=lambda x: -abs(x["delta_mpg"]))
        return {"items": items, "window_days": window_days, "last_updated": self.anchor.isoformat()}

    def usage(self, window_days: int) -> dict:
        items = []
        for games in self.by_player.values():
            window, l5 = self._split(games, window_days)
            if not window:
                continue
            s_usg = sum(g["usg"] for g in games) / len(games)
            l_usg = sum(g["usg"] for g in l5) / len(l5)
            s_mpg = sum(g["min"] or 0 for g in games) / len(games)
            l_mpg = sum(g["min"] or 0 for g in l5) / len(l5)
            d_usg, d_mpg = l_usg - s_usg, l_mpg - s_mpg
            big_min, big_usg = abs(d_mpg) >= 4.0, abs(d_usg) >= 2.0
            badge = None
            if big_min and big_usg and (d_mpg > 0) == (d_usg > 0):
                badge = "Role ↑" if d_mpg > 0 else "Role ↓"
            elif big_min and not big_usg:
                badge = "Minutes ↑" if d_mpg > 0 else "Minutes ↓"
            elif big_usg and not big_min:
                badge = "Usage ↑" if d_usg > 0 else "Usage ↓"
            items.append({
                **self._meta(games),
                "games_last_15d": len(window),
                "season_usg": s_usg, "l5_usg": l_usg, "delta_usg": d_usg,
                "season_mpg": s_mpg, "l5_mpg": l_mpg, "delta_mpg": d_mpg,
                "season_gp": len(games), "window_gp": len(window), "role_badge": badge,
            })
        items.sort(key=lambda x: -abs(x["delta_usg"]))
        return {"items": items, "window_days": window_days, "last_updated": self.anchor.isoformat()}

    def regression(self, window_days: int, baseline_seasons: int, mode: str) -> dict:
        items = []
        for games in self.by_player.values():
            if len(games) < 5:
                continue
            window, _ = self._split(games, window_days)
            base = self.base_by_name.get(games[-1]["player_name"], [])
            if mode == "form":
                base = [g for g in games if g not in window]
            stats = []
            for label, made, att in (("3P%", "fg3m", "fg3a"), ("FT%", "ftm", "fta"), ("FG%", "fgm", "fga")):
                cur_rows = games if mode == "season" else window
                cur, cur_att = _pct(cur_rows, made, att), _att(cur_rows, att)
                base_pct = _pct(base, made, att) if base else self.league[label]
                if cur_att < 10 or not base_pct:
                    continue
                dev = cur - base_pct
                win_att = _att(window, att)
                apg = cur_att / max(len(cur_rows), 1)
                if abs(dev) * apg / 100 < 0.35:
                    continue
                stats.append({
                    "stat": label, "current_pct": cur, "baseline_pct": base_pct, "dev": dev,
                    "attempts_per_game": apg, "drift_score": abs(dev) * apg / 100,
                    "window_pct": _pct(window, made, att) if win_att else None,
                    "window_attempts": win_att, "z": None,
                })
            if not stats:
                continue
            stats.sort(key=lambda s: -s["drift_score"])
            items.append({
                **self._meta(games),
                "games_last_15d": len(window),
                "stats": stats,
            })
        items.sort(key=lambda g: -g["stats"][0]["drift_score"])
        return {"items": items, "window_days": window_days, "baseline_seasons": baseline_seasons,
                "mode": mode, "last_updated": self.anchor.isoformat()}

    def gamelog(self, player_id: int, window_days: int, baseline_seasons: int, mode: str) -> dict | None:
        games = self.by_player.get(player_id)
        if not games:
            return None
        window, _ = self._split(games, window_days)
        base = self.base_by_name.get(games[-1]["player_name"], [])
        if mode == "form":
            base = [g for g in games if g not in window]
        return {
            "player_id": player_id,
            "player_name": games[-1]["player_name"],
            "season": SEASON,
            "window_days": window_days,
            "window_start": (self.anchor - timedelta(days=window_days)).isoformat(),
            "season_gp": len(games),
            "season_mpg": sum(g["min"] or 0 for g in games) / len(games),
            "season_usg": sum(g["usg"] for g in games) / len(games),
            "season_pct": {k: _pct(games, m, a) for k, m, a in
                           (("3P%", "fg3m", "fg3a"), ("FT%", "ftm", "fta"), ("FG%", "fgm", "fga"))},
            "baseline_pct": {k: (_pct(base, m, a) if base else self.league[k]) for k, m, a in
                             (("3P%", "fg3m", "fg3a"), ("FT%", "ftm", "fta"), ("FG%", "fgm", "fga"))},
            "league_pct": self.league,
            "league_usg": self.league_usg,
            "baseline_seasons": baseline_seasons,
            "games": [{
                "game_date": g["game_date"].isoformat(), "matchup": g["matchup"],
                "min": g["min"] or 0, "usg": g["usg"],
                "fgm": g["fgm"] or 0, "fga": g["fga"] or 0,
                "ftm": g["ftm"] or 0, "fta": g["fta"] or 0,
                "fg3m": g["fg3m"] or 0, "fg3a": g["fg3a"] or 0,
            } for g in games],
        }


def _att(rows: list[dict], att: str) -> int:
    return int(sum(r[att] or 0 for r in rows))


def _pct(rows: list[dict], made: str, att: str) -> float:
    a = sum(r[att] or 0 for r in rows)
    if not a:
        return 0.0
    return 100.0 * sum(r[made] or 0 for r in rows) / a

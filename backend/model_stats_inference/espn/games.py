"""Turn ESPN scoreboard + game-summary JSON into the pipeline's game-log frames.

Output schema is the one the whole model pipeline is built on (research
filters, feature engineering, fs_player_games / fs_team_games):

  players : PLAYER_ID, GAME_ID, SEASON, GAME_DATE, PLAYER_NAME, TEAM_ID,
            MATCHUP, POSITION, MIN, PTS, REB, OREB, DREB, AST, FG3M, FG3A,
            STL, BLK, TOV, FGM, FGA, FTM, FTA, PF, PLUS_MINUS
  teams   : TEAM_ID, GAME_ID, SEASON, GAME_DATE, TEAM_NAME, MATCHUP,
            PTS, REB, AST, STL, BLK, FG3M, FG_PCT, FGA, FTA, TOV

IDs are ESPN-native: PLAYER_ID = ESPN athlete id, TEAM_ID = ESPN team id
(1-30), GAME_ID = ESPN event id (string).

Which games count: ESPN labels the All-Star game and the NBA Cup championship
``season.type == 2`` (regular season) even though the NBA excludes both from
regular-season stats — so countability needs three checks, not one (see
``is_countable``).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import pandas as pd

from . import client
from .teams import TEAM_ID_TO_ABBR, TEAM_ID_TO_NAME, TEAM_IDS

logger = logging.getLogger(__name__)

REGULAR_SEASON_TYPE = 2

PLAYER_COLUMNS = [
    "PLAYER_ID", "GAME_ID", "SEASON", "GAME_DATE", "PLAYER_NAME", "TEAM_ID",
    "MATCHUP", "POSITION", "MIN", "PTS", "REB", "OREB", "DREB", "AST", "FG3M",
    "FG3A", "STL", "BLK", "TOV", "FGM", "FGA", "FTM", "FTA", "PF", "PLUS_MINUS",
]
TEAM_COLUMNS = [
    "TEAM_ID", "GAME_ID", "SEASON", "GAME_DATE", "TEAM_NAME", "MATCHUP",
    "PTS", "REB", "AST", "STL", "BLK", "FG3M", "FG_PCT", "FGA", "FTA", "TOV",
]

# ESPN team-boxscore stat names -> our columns (made-attempted pairs split below).
_TEAM_STAT_MAP = {
    "totalRebounds": "REB",
    "assists": "AST",
    "steals": "STL",
    "blocks": "BLK",
    "totalTurnovers": "TOV",
}


@dataclass
class DayFetch:
    """One scoreboard day: countable regular-season games and their box scores."""
    game_date: date
    players: pd.DataFrame
    teams: pd.DataFrame
    expected_games: int   # countable games on the scoreboard
    all_final: bool       # every countable game is final


def season_for(d: date) -> str:
    """NBA season string ("YYYY-YY") the given date belongs to (Aug+ = new season)."""
    start = d.year if d.month >= 8 else d.year - 1
    return f"{start}-{str(start + 1)[-2:]}"


def event_game_date(event: dict) -> date:
    """Game date in US/Eastern (ESPN event dates are UTC; a 10pm ET tip is the
    next day in UTC, and the pipeline's GAME_DATE convention is the US date)."""
    return pd.Timestamp(event["date"]).tz_convert("America/New_York").date()


def is_countable(event: dict) -> bool:
    """True for games that count in NBA regular-season stats.

    Three checks because ESPN's season.type alone over-counts:
      1. season.type == 2 (drops preseason/playoffs/play-in),
      2. both competitors are real NBA teams (drops All-Star exhibitions,
         which ESPN labels type 2 with synthetic team ids),
      3. not the NBA Cup / In-Season Tournament championship game (also
         labeled type 2; the NBA excludes it from regular-season stats).
    """
    if event.get("season", {}).get("type") != REGULAR_SEASON_TYPE:
        return False
    comp = event["competitions"][0]
    competitors = comp.get("competitors", [])
    if len(competitors) != 2:
        return False
    if any(int(c["team"]["id"]) not in TEAM_IDS for c in competitors):
        return False
    for note in comp.get("notes", []):
        headline = note.get("headline", "")
        if "Championship" in headline and ("Cup" in headline or "In-Season Tournament" in headline):
            return False
        if "All-Star" in headline:
            return False
    return True


def is_final(event: dict) -> bool:
    return bool(event.get("status", {}).get("type", {}).get("completed"))


# --- parsing helpers ---------------------------------------------------------

def _split_made_att(s: str) -> tuple[float, float]:
    """'3-5' -> (3.0, 5.0)."""
    made, att = str(s).split("-")
    return float(made), float(att)


def _num(s: str) -> float:
    """'+2' / '-5' / '17' -> float; unparseable ('--') -> 0.0."""
    try:
        return float(str(s).lstrip("+"))
    except ValueError:
        return 0.0


def _matchup(abbr: str, opp_abbr: str, is_home: bool) -> str:
    return f"{abbr} vs. {opp_abbr}" if is_home else f"{abbr} @ {opp_abbr}"


# --- row building --------------------------------------------------------------

def build_game_rows(event: dict, summary: dict) -> tuple[list[dict], list[dict]]:
    """One final game's summary JSON -> (player rows, team rows).

    Raises KeyError/ValueError on summaries missing the boxscore blocks — the
    caller decides whether that means "retry later" (nightly) or "skip" (bulk).
    """
    game_id = str(event["id"])
    game_date = pd.Timestamp(event_game_date(event))
    season = season_for(game_date.date())

    header_competitors = summary["header"]["competitions"][0]["competitors"]
    home_away = {int(c["id"]): c["homeAway"] == "home" for c in header_competitors}
    scores = {int(c["id"]): float(c["score"]) for c in header_competitors}
    ids = list(home_away)
    opponent = {ids[0]: ids[1], ids[1]: ids[0]}

    meta = {
        tid: {
            "GAME_ID": game_id,
            "SEASON": season,
            "GAME_DATE": game_date,
            "MATCHUP": _matchup(
                TEAM_ID_TO_ABBR[tid], TEAM_ID_TO_ABBR[opponent[tid]], home_away[tid]
            ),
        }
        for tid in ids
    }

    # Team rows.
    team_rows = []
    for tb in summary["boxscore"]["teams"]:
        tid = int(tb["team"]["id"])
        stats = {s["name"]: s["displayValue"] for s in tb.get("statistics", [])}
        fgm, fga = _split_made_att(stats["fieldGoalsMade-fieldGoalsAttempted"])
        fg3m, _fg3a = _split_made_att(stats["threePointFieldGoalsMade-threePointFieldGoalsAttempted"])
        _ftm, fta = _split_made_att(stats["freeThrowsMade-freeThrowsAttempted"])
        row = {
            "TEAM_ID": tid,
            "TEAM_NAME": TEAM_ID_TO_NAME[tid],
            **meta[tid],
            "PTS": scores[tid],
            "FG3M": fg3m,
            "FG_PCT": fgm / fga if fga else 0.0,
            "FGA": fga,
            "FTA": fta,
        }
        for espn_name, col in _TEAM_STAT_MAP.items():
            row[col] = _num(stats[espn_name])
        team_rows.append(row)

    # Player rows.
    player_rows = []
    for block in summary["boxscore"]["players"]:
        tid = int(block["team"]["id"])
        stat_block = block["statistics"][0]
        idx = {name: i for i, name in enumerate(stat_block["names"])}
        for a in stat_block["athletes"]:
            vals = a.get("stats") or []
            if a.get("didNotPlay") or len(vals) != len(stat_block["names"]):
                continue
            # Rare: a bench DNP entry without an athlete id (all stats "--"/0,
            # not flagged didNotPlay). Unkeyable and zero-minute — skip it.
            if "id" not in a.get("athlete", {}):
                continue
            fgm, fga = _split_made_att(vals[idx["FG"]])
            fg3m, fg3a = _split_made_att(vals[idx["3PT"]])
            ftm, fta = _split_made_att(vals[idx["FT"]])
            player_rows.append({
                "PLAYER_ID": int(a["athlete"]["id"]),
                "PLAYER_NAME": str(a["athlete"]["displayName"]),
                "TEAM_ID": tid,
                **meta[tid],
                "POSITION": str(a["athlete"].get("position", {}).get("abbreviation", "")),
                "MIN": _num(vals[idx["MIN"]]),
                "PTS": _num(vals[idx["PTS"]]),
                "REB": _num(vals[idx["REB"]]),
                "OREB": _num(vals[idx["OREB"]]),
                "DREB": _num(vals[idx["DREB"]]),
                "AST": _num(vals[idx["AST"]]),
                "FG3M": fg3m,
                "FG3A": fg3a,
                "STL": _num(vals[idx["STL"]]),
                "BLK": _num(vals[idx["BLK"]]),
                "TOV": _num(vals[idx["TO"]]),
                "FGM": fgm,
                "FGA": fga,
                "FTM": ftm,
                "FTA": fta,
                "PF": _num(vals[idx["PF"]]),
                "PLUS_MINUS": _num(vals[idx["+/-"]]),
            })

    return player_rows, team_rows


def _frames(player_rows: list[dict], team_rows: list[dict]) -> tuple[pd.DataFrame, pd.DataFrame]:
    players = pd.DataFrame(player_rows, columns=PLAYER_COLUMNS)
    teams = pd.DataFrame(team_rows, columns=TEAM_COLUMNS)
    return players, teams


# --- fetch entry points -------------------------------------------------------

def fetch_day(game_date: date) -> DayFetch:
    """One night's countable games with box scores (the nightly-ingest fetch)."""
    sb = client.scoreboard(game_date.strftime("%Y%m%d"))
    events = [e for e in sb.get("events", []) if is_countable(e)]
    all_final = all(is_final(e) for e in events) if events else True

    player_rows: list[dict] = []
    team_rows: list[dict] = []
    for event in events:
        if not is_final(event):
            continue
        p, t = build_game_rows(event, client.game_summary(str(event["id"])))
        player_rows.extend(p)
        team_rows.extend(t)

    players, teams = _frames(player_rows, team_rows)
    return DayFetch(game_date, players, teams, len(events), all_final)


def fetch_month(yyyymm: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    """All countable, final games of one calendar month (the bulk-pull unit)."""
    sb = client.scoreboard(yyyymm)
    events = [e for e in sb.get("events", []) if is_countable(e) and is_final(e)]
    logger.info(f"ESPN {yyyymm}: {len(events)} countable final games")

    player_rows: list[dict] = []
    team_rows: list[dict] = []
    for i, event in enumerate(events, 1):
        try:
            p, t = build_game_rows(event, client.game_summary(str(event["id"])))
        except (KeyError, ValueError) as e:
            # A final game with a malformed summary would silently thin the
            # dataset — surface it instead of skipping quietly.
            raise RuntimeError(f"unparseable summary for event {event['id']} ({yyyymm})") from e
        player_rows.extend(p)
        team_rows.extend(t)
        if i % 50 == 0:
            logger.info(f"  {yyyymm}: {i}/{len(events)} games")

    return _frames(player_rows, team_rows)


def season_months(season: str) -> list[str]:
    """Scoreboard months ("YYYYMM") covering one regular season (Oct-Apr)."""
    start_year = int(season[:4])
    months = [f"{start_year}{m:02d}" for m in (10, 11, 12)]
    months += [f"{start_year + 1}{m:02d}" for m in (1, 2, 3, 4)]
    return months


def fetch_seasons(
    seasons: list[str], cache_dir: Path | None = None
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Bulk pull: every countable game of the given seasons, month-cached.

    With ``cache_dir`` each month's frames are parquet-cached, so an
    interrupted multi-thousand-request pull resumes where it stopped.
    """
    player_frames: list[pd.DataFrame] = []
    team_frames: list[pd.DataFrame] = []
    for season in seasons:
        for month in season_months(season):
            if cache_dir is not None:
                p_path = cache_dir / f"espn_{month}_players.parquet"
                t_path = cache_dir / f"espn_{month}_teams.parquet"
                if p_path.exists() and t_path.exists():
                    player_frames.append(pd.read_parquet(p_path))
                    team_frames.append(pd.read_parquet(t_path))
                    continue
            players, teams = fetch_month(month)
            if cache_dir is not None:
                cache_dir.mkdir(parents=True, exist_ok=True)
                players.to_parquet(p_path, index=False)
                teams.to_parquet(t_path, index=False)
            player_frames.append(players)
            team_frames.append(teams)

    players = pd.concat(player_frames, ignore_index=True)
    teams = pd.concat(team_frames, ignore_index=True)
    # A season's own months never overlap, but calendar months at season
    # boundaries can't double-count either (game ids are unique) — dedup anyway.
    players = players.drop_duplicates(["PLAYER_ID", "GAME_ID"]).reset_index(drop=True)
    teams = teams.drop_duplicates(["TEAM_ID", "GAME_ID"]).reset_index(drop=True)
    return players, teams

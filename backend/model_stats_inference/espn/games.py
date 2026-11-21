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
from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import polars as pl

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
_TEXT = {"GAME_ID", "SEASON", "PLAYER_NAME", "TEAM_NAME", "MATCHUP", "POSITION"}
_IDS = {"PLAYER_ID", "TEAM_ID"}


def _schema(columns: list[str]) -> dict:
    return {
        c: pl.Int64 if c in _IDS else pl.String if c in _TEXT else pl.Date if c == "GAME_DATE" else pl.Float64
        for c in columns
    }


PLAYER_SCHEMA = _schema(PLAYER_COLUMNS)
TEAM_SCHEMA = _schema(TEAM_COLUMNS)
_EASTERN = ZoneInfo("America/New_York")

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
    players: pl.DataFrame
    teams: pl.DataFrame
    expected_games: int   # countable games on the scoreboard
    all_final: bool       # every countable game is final
    total_events: int = 0  # raw scoreboard event count, before the countability filter


def season_for(d: date) -> str:
    """NBA season string ("YYYY-YY") the given date belongs to (Aug+ = new season)."""
    start = d.year if d.month >= 8 else d.year - 1
    return f"{start}-{str(start + 1)[-2:]}"


def event_game_date(event: dict) -> date:
    """Game date in US/Eastern (ESPN event dates are UTC; a 10pm ET tip is the
    next day in UTC, and the pipeline's GAME_DATE convention is the US date)."""
    return _utc(event["date"]).astimezone(_EASTERN).date()


def _utc(stamp: str) -> datetime:
    """ESPN's event time ("2025-11-06T00:30Z") as an aware UTC datetime."""
    d = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc)


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


# A game ESPN has called off stays on its original date's scoreboard but never
# completes; its makeup is a separate entry on the new date. Counting it would
# leave that night incomplete forever, and the nightly catch-up stops at the
# first incomplete night, so every later night would wait behind it.
CALLED_OFF_STATUSES = frozenset({"STATUS_POSTPONED", "STATUS_CANCELED", "STATUS_CANCELLED"})


def is_called_off(event: dict) -> bool:
    return event.get("status", {}).get("type", {}).get("name") in CALLED_OFF_STATUSES


def expected_events(scoreboard: dict) -> list[dict]:
    """The night's games the nightly waits for: countable and not called off."""
    return [e for e in scoreboard.get("events", []) if is_countable(e) and not is_called_off(e)]


def last_tip(scoreboard: dict) -> datetime | None:
    """Start time (UTC) of the night's latest expected game; None without one."""
    tips = []
    for event in expected_events(scoreboard):
        try:
            tips.append(_utc(event["date"]))
        except (KeyError, TypeError, ValueError):
            continue
    return max(tips) if tips else None


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
    game_date = event_game_date(event)
    season = season_for(game_date)

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

    # Team rows. ESPN's team-boxscore block occasionally glitches (e.g.
    # totalTurnovers=0) while the player rows of the same game are correct, so
    # every additive stat is floored by the team's player-row sums (a true team
    # total can exceed the player sum — team rebounds/turnovers — never trail it).
    psums = _player_sums(player_rows)
    team_rows = []
    for tb in summary["boxscore"]["teams"]:
        tid = int(tb["team"]["id"])
        ps = psums.get(tid, {})
        stats = {s["name"]: s["displayValue"] for s in tb.get("statistics", [])}
        fgm, fga = _split_made_att(stats["fieldGoalsMade-fieldGoalsAttempted"])
        fg3m, _fg3a = _split_made_att(stats["threePointFieldGoalsMade-threePointFieldGoalsAttempted"])
        _ftm, fta = _split_made_att(stats["freeThrowsMade-freeThrowsAttempted"])
        fgm = max(fgm, ps.get("FGM", 0.0))
        fga = max(fga, ps.get("FGA", 0.0))
        row = {
            "TEAM_ID": tid,
            "TEAM_NAME": TEAM_ID_TO_NAME[tid],
            **meta[tid],
            "PTS": scores[tid],
            "FG3M": max(fg3m, ps.get("FG3M", 0.0)),
            "FG_PCT": fgm / fga if fga else 0.0,
            "FGA": fga,
            "FTA": max(fta, ps.get("FTA", 0.0)),
        }
        for espn_name, col in _TEAM_STAT_MAP.items():
            row[col] = max(_num(stats[espn_name]), ps.get(col, 0.0))
        team_rows.append(row)

    return player_rows, team_rows


def _player_sums(player_rows: list[dict]) -> dict[int, dict[str, float]]:
    """Per-team sums of the additive stats, from the game's player rows."""
    out: dict[int, dict[str, float]] = {}
    for r in player_rows:
        team = out.setdefault(r["TEAM_ID"], {})
        for stat in ("REB", "AST", "STL", "BLK", "TOV", "FGM", "FGA", "FTA", "FG3M"):
            team[stat] = team.get(stat, 0.0) + r[stat]
    return out


def _frames(player_rows: list[dict], team_rows: list[dict]) -> tuple[pl.DataFrame, pl.DataFrame]:
    players = pl.from_dicts(player_rows, schema=PLAYER_SCHEMA) if player_rows else pl.DataFrame(schema=PLAYER_SCHEMA)
    teams = pl.from_dicts(team_rows, schema=TEAM_SCHEMA) if team_rows else pl.DataFrame(schema=TEAM_SCHEMA)
    return players, teams


# --- fetch entry points -------------------------------------------------------

def fetch_day(game_date: date) -> DayFetch:
    """One night's countable games with box scores (the nightly-ingest fetch)."""
    sb = client.scoreboard(game_date.strftime("%Y%m%d"))
    total_events = len(sb.get("events", []))
    events = expected_events(sb)
    all_final = all(is_final(e) for e in events) if events else True

    player_rows: list[dict] = []
    team_rows: list[dict] = []
    for event in events:
        if not is_final(event):
            continue
        try:
            p, t = build_game_rows(event, client.game_summary(str(event["id"])))
        except (KeyError, ValueError, client.EspnUnavailableError) as e:
            # One bad/unreachable summary must not sink the whole night: the
            # other games in player_rows/team_rows still return below, and the
            # resulting short team_rows count makes NightFetch.complete False
            # (see nightly.fetch_night), so the scheduler retries just this
            # game at its next slot instead of losing the night silently.
            logger.warning(f"skipping event {event['id']} ({game_date}): {e}")
            continue
        player_rows.extend(p)
        team_rows.extend(t)

    players, teams = _frames(player_rows, team_rows)
    return DayFetch(game_date, players, teams, len(events), all_final, total_events)


def fetch_month(yyyymm: str) -> tuple[pl.DataFrame, pl.DataFrame]:
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
) -> tuple[pl.DataFrame, pl.DataFrame]:
    """Bulk pull: every countable game of the given seasons, month-cached.

    With ``cache_dir`` each month's frames are parquet-cached, so an
    interrupted multi-thousand-request pull resumes where it stopped.

    Only *finished* months are cached: caching the current (or a future) month
    would freeze a half-played month's games into a file that is never refetched,
    silently thinning every later pull.
    """
    current_month = date.today().strftime("%Y%m")
    player_frames: list[pl.DataFrame] = []
    team_frames: list[pl.DataFrame] = []
    for season in seasons:
        for month in season_months(season):
            paths = (
                (cache_dir / f"espn_{month}_players.parquet",
                 cache_dir / f"espn_{month}_teams.parquet")
                if cache_dir is not None and month < current_month
                else None
            )
            if paths is not None and paths[0].exists() and paths[1].exists():
                player_frames.append(_conform(pl.read_parquet(paths[0]), PLAYER_SCHEMA))
                team_frames.append(_conform(pl.read_parquet(paths[1]), TEAM_SCHEMA))
                continue
            players, teams = fetch_month(month)
            if paths is not None:
                paths[0].parent.mkdir(parents=True, exist_ok=True)
                players.write_parquet(paths[0])
                teams.write_parquet(paths[1])
            player_frames.append(players)
            team_frames.append(teams)

    players = pl.concat(player_frames) if player_frames else pl.DataFrame(schema=PLAYER_SCHEMA)
    teams = pl.concat(team_frames) if team_frames else pl.DataFrame(schema=TEAM_SCHEMA)
    # A season's own months never overlap, but calendar months at season
    # boundaries can't double-count either (game ids are unique) — dedup anyway.
    players = players.unique(subset=["PLAYER_ID", "GAME_ID"], keep="first", maintain_order=True)
    teams = teams.unique(subset=["TEAM_ID", "GAME_ID"], keep="first", maintain_order=True)
    return players, teams


def _conform(df: pl.DataFrame, schema: dict) -> pl.DataFrame:
    """A month cached by an older (pandas) writer: same columns, our dtypes."""
    return df.select([pl.col(c).cast(t) for c, t in schema.items()])

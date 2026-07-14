"""Load, filter and cache the nba_api game-log datasets.

Produces two clean, leakage-free-of-filters tables (caching to parquet):

  - ``players``       : one row per player per qualifying game (regular season,
                        >= MIN_MINUTES played, player has >= MIN_PLAYER_GAMES).
  - ``team_allowed``  : one row per team per game with the stats the OPPONENT
                        put up against them (ALLOWED_*), plus the opponent id.

Both keep ``GAME_DATE`` as datetime and are sorted for downstream windowing.
"""

from __future__ import annotations

import time

import pandas as pd
from nba_api.stats.endpoints import (
    commonteamroster,
    draftcombineplayeranthro,
    playergamelogs,
    playerindex,
    teamgamelogs,
)
from nba_api.stats.static import teams as static_teams

from . import config

REQUEST_TIMEOUT = 60
SLEEP_BETWEEN_CALLS = 1.0

# Regular-season GAME_IDs start with "002" — used as a safety net on top of the
# season_type request param.
REGULAR_SEASON_PREFIX = "002"


# --- Raw fetch -------------------------------------------------------------

def _fetch(endpoint_cls, seasons: list[str], label: str) -> pd.DataFrame:
    frames = []
    for season in seasons:
        print(f"  -> {label} {season} ...", flush=True)
        df = endpoint_cls(
            season_nullable=season,
            season_type_nullable=config.SEASON_TYPE,
            timeout=REQUEST_TIMEOUT,
        ).get_data_frames()[0]
        df.insert(0, "SEASON", season)
        frames.append(df)
        time.sleep(SLEEP_BETWEEN_CALLS)
    return pd.concat(frames, ignore_index=True)


def fetch_player_logs(seasons: list[str]) -> pd.DataFrame:
    return _fetch(playergamelogs.PlayerGameLogs, seasons, "player logs")


def fetch_team_logs(seasons: list[str]) -> pd.DataFrame:
    return _fetch(teamgamelogs.TeamGameLogs, seasons, "team logs")


def fetch_positions(seasons: list[str]) -> pd.DataFrame:
    """PLAYER_ID -> POSITION from team rosters (most recent season wins).

    POSITION values look like 'G', 'F', 'C', 'G-F', 'F-C' — encoded downstream as
    multi-hot IS_GUARD/IS_FORWARD/IS_CENTER.
    """
    team_ids = [t["id"] for t in static_teams.get_teams()]
    pos: dict[int, str] = {}
    for season in seasons:  # later seasons overwrite -> most recent position kept
        print(f"  -> rosters {season} ({len(team_ids)} teams) ...", flush=True)
        for tid in team_ids:
            df = commonteamroster.CommonTeamRoster(
                team_id=tid, season=season, timeout=REQUEST_TIMEOUT
            ).get_data_frames()[0]
            for pid, position in zip(df["PLAYER_ID"], df["POSITION"]):
                pos[int(pid)] = position
            time.sleep(0.6)
    return pd.DataFrame({"PLAYER_ID": list(pos), "POSITION": list(pos.values())})


# --- Player bio / anthro (static per player) --------------------------------

def _height_to_inches(h: object) -> float:
    """'6-8' -> 80.0; anything unparseable -> NaN."""
    try:
        ft, inch = str(h).split("-")
        return int(ft) * 12 + int(inch)
    except (ValueError, AttributeError):
        return float("nan")


def fetch_player_bio(seasons: list[str]) -> pd.DataFrame:
    """PLAYER_ID -> HEIGHT_IN / WEIGHT_LB (playerindex, latest season wins) plus
    WINGSPAN_IN / REACH_IN / WING_MINUS_HEIGHT (draft combine, partial coverage).

    Missing combine values stay NaN — the HGB models ingest NaN natively, so a
    player without combine data simply falls back to the other features.
    """
    bio: dict[int, tuple[float, float]] = {}
    for season in seasons:  # later seasons overwrite -> most recent bio kept
        print(f"  -> playerindex {season} ...", flush=True)
        df = playerindex.PlayerIndex(season=season, timeout=REQUEST_TIMEOUT).get_data_frames()[0]
        for _, r in df.iterrows():
            bio[int(r["PERSON_ID"])] = (
                _height_to_inches(r["HEIGHT"]),
                pd.to_numeric(r["WEIGHT"], errors="coerce"),
            )
        time.sleep(SLEEP_BETWEEN_CALLS)
    out = pd.DataFrame(
        {
            "PLAYER_ID": list(bio),
            "HEIGHT_IN": [v[0] for v in bio.values()],
            "WEIGHT_LB": [v[1] for v in bio.values()],
        }
    )

    frames = []
    for year in config.COMBINE_YEARS:
        print(f"  -> combine anthro {year} ...", flush=True)
        df = draftcombineplayeranthro.DraftCombinePlayerAnthro(
            league_id="00", season_year=str(year), timeout=REQUEST_TIMEOUT
        ).get_data_frames()[0]
        df["COMBINE_YEAR"] = year
        frames.append(df)
        time.sleep(SLEEP_BETWEEN_CALLS)
    anthro = pd.concat(frames, ignore_index=True)
    anthro = anthro.sort_values("COMBINE_YEAR").drop_duplicates("PLAYER_ID", keep="last")
    anthro = pd.DataFrame(
        {
            "PLAYER_ID": anthro["PLAYER_ID"].astype(int),
            "WINGSPAN_IN": pd.to_numeric(anthro["WINGSPAN"], errors="coerce"),
            "REACH_IN": pd.to_numeric(anthro["STANDING_REACH"], errors="coerce"),
            "_COMBINE_HEIGHT": pd.to_numeric(anthro["HEIGHT_WO_SHOES"], errors="coerce"),
        }
    )

    out = out.merge(anthro, on="PLAYER_ID", how="outer")
    out["WING_MINUS_HEIGHT"] = out["WINGSPAN_IN"] - out["_COMBINE_HEIGHT"]
    return out.drop(columns=["_COMBINE_HEIGHT"])[["PLAYER_ID", *config.BIO_COLUMNS]]


def load_or_fetch_bio(refresh: bool = False) -> pd.DataFrame:
    """Load the committed bio artifact, fetching + writing it when absent/refresh."""
    if not refresh and config.BIO_PATH.exists():
        return pd.read_parquet(config.BIO_PATH)
    print("Fetching player bio/anthro:")
    bio = fetch_player_bio(config.SEASONS)
    config.BIO_PATH.parent.mkdir(parents=True, exist_ok=True)
    bio.to_parquet(config.BIO_PATH, index=False)
    print(f"Cached -> {config.BIO_PATH}")
    return bio


# --- Cleaning / filtering --------------------------------------------------

def _to_datetime(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["GAME_DATE"] = pd.to_datetime(df["GAME_DATE"], errors="coerce")
    return df


def _regular_season_only(df: pd.DataFrame) -> pd.DataFrame:
    return df[df["GAME_ID"].str.startswith(REGULAR_SEASON_PREFIX)].copy()


def filter_players(players: pd.DataFrame) -> pd.DataFrame:
    """Apply the user's row + player filters and report what was dropped."""
    n0 = len(players)

    # Drop DNP / sub-MIN_MINUTES games entirely (not targets, not history).
    players = players[players["MIN"].notna() & (players["MIN"] >= config.MIN_MINUTES)]
    n1 = len(players)
    print(f"  dropped {n0 - n1:,} rows with MIN < {config.MIN_MINUTES} (DNP/garbage time)")

    # Drop players without enough qualifying games.
    counts = players.groupby("PLAYER_ID")["GAME_ID"].transform("size")
    players = players[counts >= config.MIN_PLAYER_GAMES]
    n2 = len(players)
    kept_players = players["PLAYER_ID"].nunique()
    print(
        f"  dropped {n1 - n2:,} rows from players with < {config.MIN_PLAYER_GAMES} "
        f"games; {kept_players:,} players remain"
    )
    return players


# --- Opponent "allowed" table ----------------------------------------------

def build_team_allowed(team_logs: pd.DataFrame) -> pd.DataFrame:
    """For every team-game, attach the stats the opponent produced (ALLOWED_*).

    Self-join team logs on GAME_ID: the opponent is the other team in the game.
    """
    cols = ["GAME_ID", "TEAM_ID", "GAME_DATE", "SEASON"] + [
        c for c in config.OPP_ALLOWED_STATS if c in team_logs.columns
    ]
    # possession / pace proxy for each team-game
    base = team_logs.copy()
    base["PACE_PROXY"] = base["FGA"] + 0.44 * base["FTA"] + base["TOV"]
    left = base[cols + ["PACE_PROXY"]].copy()

    merged = left.merge(left, on="GAME_ID", suffixes=("", "_OPP"))
    merged = merged[merged["TEAM_ID"] != merged["TEAM_ID_OPP"]].copy()

    out = pd.DataFrame(
        {
            "GAME_ID": merged["GAME_ID"],
            "GAME_DATE": merged["GAME_DATE"],
            "SEASON": merged["SEASON"],
            "TEAM_ID": merged["TEAM_ID"],
            "OPP_TEAM_ID": merged["TEAM_ID_OPP"],
        }
    )
    # ALLOWED_X = what the opponent scored/did against TEAM_ID
    for stat in config.OPP_ALLOWED_STATS:
        if f"{stat}_OPP" in merged.columns:
            out[f"ALLOWED_{stat}"] = merged[f"{stat}_OPP"].to_numpy()
    out["ALLOWED_PACE"] = merged["PACE_PROXY_OPP"].to_numpy()
    return out.sort_values(["TEAM_ID", "GAME_DATE"]).reset_index(drop=True)


def build_team_own(team_logs: pd.DataFrame) -> pd.DataFrame:
    """Each team-game with the team's OWN production (offensive context / pace)."""
    base = team_logs.copy()
    out = base[["GAME_ID", "GAME_DATE", "SEASON", "TEAM_ID"]].copy()
    for stat in config.TEAM_OWN_STATS:
        out[f"TEAM_{stat}"] = base[stat].to_numpy()
    out["TEAM_PACE"] = (base["FGA"] + 0.44 * base["FTA"] + base["TOV"]).to_numpy()
    return out.sort_values(["TEAM_ID", "GAME_DATE"]).reset_index(drop=True)


# --- Orchestration ---------------------------------------------------------

def load_or_build(refresh: bool = False) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    config.DATA_DIR.mkdir(exist_ok=True)
    players_path = config.DATA_DIR / "players.parquet"
    allowed_path = config.DATA_DIR / "team_allowed.parquet"
    own_path = config.DATA_DIR / "team_own.parquet"

    if not refresh and players_path.exists() and allowed_path.exists() and own_path.exists():
        print(f"Loading cached data from {config.DATA_DIR}")
        return (
            pd.read_parquet(players_path),
            pd.read_parquet(allowed_path),
            pd.read_parquet(own_path),
        )

    print(f"Fetching {config.SEASON_TYPE}: {', '.join(config.SEASONS)}")
    print("Player game logs:")
    players = _regular_season_only(_to_datetime(fetch_player_logs(config.SEASONS)))
    print("Team game logs:")
    team_logs = _regular_season_only(_to_datetime(fetch_team_logs(config.SEASONS)))

    print("Filtering players:")
    players = filter_players(players)
    players = players.sort_values(["PLAYER_ID", "GAME_DATE"]).reset_index(drop=True)

    print("Fetching player positions:")
    positions = fetch_positions(config.SEASONS)
    players = players.merge(positions, on="PLAYER_ID", how="left")

    print("Building opponent allowed + own-team tables:")
    team_allowed = build_team_allowed(team_logs)
    team_own = build_team_own(team_logs)

    players.to_parquet(players_path, index=False)
    team_allowed.to_parquet(allowed_path, index=False)
    team_own.to_parquet(own_path, index=False)
    print(f"Cached -> {players_path.name}, {allowed_path.name}, {own_path.name}")
    return players, team_allowed, team_own

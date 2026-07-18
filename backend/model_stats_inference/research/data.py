"""Load, filter and cache the ESPN game-log datasets.

Produces two clean, leakage-free-of-filters tables (caching to parquet):

  - ``players``       : one row per player per qualifying game (regular season,
                        >= MIN_MINUTES played, player has >= MIN_PLAYER_GAMES).
  - ``team_allowed``  : one row per team per game with the stats the OPPONENT
                        put up against them (ALLOWED_*), plus the opponent id.

Both keep ``GAME_DATE`` as datetime and are sorted for downstream windowing.

All ids are ESPN-native (athlete ids / team ids 1-30 / event ids); regular-season
filtering happens at fetch time in the espn package (season type + real teams +
Cup-final exclusion), so there is no game-id-prefix filter here.
"""

from __future__ import annotations

import pandas as pd

from .. import espn
from . import config


# --- Raw fetch -------------------------------------------------------------

def fetch_game_logs(seasons: list[str]) -> tuple[pd.DataFrame, pd.DataFrame]:
    """(player logs, team logs) for the given seasons, month-cached under
    DATA_DIR so an interrupted pull resumes where it stopped."""
    return espn.fetch_seasons(seasons, cache_dir=config.DATA_DIR / "espn_cache")


# --- Player bio (frozen artifact + roster refresh) ---------------------------

def load_bio() -> pd.DataFrame | None:
    """The committed bio artifact (PLAYER_ID + BIO_COLUMNS), None when absent.

    Wingspan/reach come from historical NBA draft-combine measurements and are
    static per player for life — the artifact is frozen data, not a cache.
    """
    if not config.BIO_PATH.exists():
        return None
    return pd.read_parquet(config.BIO_PATH)


def refresh_bio_from_rosters(update_existing: bool = False) -> pd.DataFrame:
    """Refresh the bio artifact from current ESPN rosters (run once a season).

    Rostered players missing from the artifact (post-freeze rookies) are added
    with HEIGHT_IN/WEIGHT_LB; their combine columns stay NaN. With
    ``update_existing`` the roster height/weight also overwrites existing rows
    (players do change listed weight between seasons). Combine measurements
    (WINGSPAN_IN/REACH_IN/WING_MINUS_HEIGHT) are frozen data and never touched.
    Rewrites the artifact in place and returns it.
    """
    bio = load_bio()
    rosters = espn.fetch_rosters().set_index("PLAYER_ID")
    known = set() if bio is None else set(bio["PLAYER_ID"])

    new = rosters[~rosters.index.isin(known)].reset_index()
    for col in config.BIO_COLUMNS:
        if col not in new.columns:
            new[col] = float("nan")
    new = new[["PLAYER_ID", *config.BIO_COLUMNS]]
    out = new if bio is None else pd.concat([bio, new], ignore_index=True)

    updated = 0
    if update_existing and bio is not None:
        for col in ("HEIGHT_IN", "WEIGHT_LB"):
            fresh = out["PLAYER_ID"].map(rosters[col])
            changed = fresh.notna() & (fresh != out[col])
            out.loc[changed, col] = fresh[changed]
            updated += int(changed.sum())

    config.BIO_PATH.parent.mkdir(parents=True, exist_ok=True)
    out.to_parquet(config.BIO_PATH, index=False)
    print(
        f"Bio artifact: +{len(new)} new players"
        + (f", {updated} height/weight values updated" if update_existing else "")
        + f" -> {config.BIO_PATH}"
    )
    return out


# --- Cleaning / filtering --------------------------------------------------

def _to_datetime(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["GAME_DATE"] = pd.to_datetime(df["GAME_DATE"], errors="coerce")
    return df


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

    print(f"Fetching {config.SEASON_TYPE} from ESPN: {', '.join(config.SEASONS)}")
    players, team_logs = fetch_game_logs(config.SEASONS)
    players = _to_datetime(players)
    team_logs = _to_datetime(team_logs)

    print("Filtering players:")
    players = filter_players(players)
    players = players.sort_values(["PLAYER_ID", "GAME_DATE"]).reset_index(drop=True)

    print("Building opponent allowed + own-team tables:")
    team_allowed = build_team_allowed(team_logs)
    team_own = build_team_own(team_logs)

    players.to_parquet(players_path, index=False)
    team_allowed.to_parquet(allowed_path, index=False)
    team_own.to_parquet(own_path, index=False)
    print(f"Cached -> {players_path.name}, {allowed_path.name}, {own_path.name}")
    return players, team_allowed, team_own

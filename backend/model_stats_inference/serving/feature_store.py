"""Feature store (design b2): keep raw game rows as the source of truth and
recompute each player's "current-state" feature vector when new results arrive.

No incremental window surgery — recomputing from dated raw rows keeps window
counts, recency caps and the include-last-game rule correct by construction.

Persistence is parquet now; the interface (build / load / save / update / get_*)
is DB-ready so a Postgres-backed implementation can drop in later.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from ..research import data as rdata
from ..research import features as rfeatures
from . import config
from .errors import (
    InsufficientHistoryError,
    UnknownPlayerError,
    UnknownTeamError,
)

# Columns on the player vector that are metadata, not model features.
_PLAYER_META = ["PLAYER_ID", "PLAYER_NAME", "TEAM_ID", "POSITION", "last_game_date", "games_count"]


@dataclass
class PlayerState:
    player_id: int
    team_id: int
    position: str
    last_game_date: pd.Timestamp
    games_count: int
    vector: pd.Series  # feature name -> value (history mean/var/rate + efficiency)


@dataclass
class TeamState:
    team_id: int
    allowed: pd.Series  # OPP_ALLOWED_* features
    own: pd.Series      # TEAM_* features


class FeatureStore:
    """Holds raw rows + materialized current-state vectors for players and teams."""

    def __init__(
        self,
        players: pd.DataFrame,
        team_allowed: pd.DataFrame,
        team_own: pd.DataFrame,
        player_vectors: pd.DataFrame,
        team_allowed_vectors: pd.DataFrame,
        team_own_vectors: pd.DataFrame,
    ):
        self.players = players
        self.team_allowed = team_allowed
        self.team_own = team_own
        self.player_vectors = player_vectors.set_index("PLAYER_ID", drop=False)
        self.team_allowed_vectors = team_allowed_vectors.set_index("TEAM_ID", drop=False)
        self.team_own_vectors = team_own_vectors.set_index("TEAM_ID", drop=False)

    # --- construction ------------------------------------------------------

    @classmethod
    def build(cls, players, team_allowed, team_own) -> "FeatureStore":
        pv, tav, tov = rfeatures.build_current_state(players, team_allowed, team_own)
        return cls(players, team_allowed, team_own, pv, tav, tov)

    @classmethod
    def from_research_cache(cls) -> "FeatureStore":
        """Build from the parquet cache produced by the research pipeline."""
        d = rdata.config.DATA_DIR
        players = pd.read_parquet(d / "players.parquet")
        team_allowed = pd.read_parquet(d / "team_allowed.parquet")
        team_own = pd.read_parquet(d / "team_own.parquet")
        return cls.build(players, team_allowed, team_own)

    # --- persistence (DB-ready; parquet now) -------------------------------

    def save(self, store_dir: Path | None = None) -> None:
        d = store_dir or config.STORE_DIR
        d.mkdir(parents=True, exist_ok=True)
        self.players.to_parquet(d / "players.parquet", index=False)
        self.team_allowed.to_parquet(d / "team_allowed.parquet", index=False)
        self.team_own.to_parquet(d / "team_own.parquet", index=False)
        self.player_vectors.to_parquet(d / "player_vectors.parquet", index=False)
        self.team_allowed_vectors.to_parquet(d / "team_allowed_vectors.parquet", index=False)
        self.team_own_vectors.to_parquet(d / "team_own_vectors.parquet", index=False)

    @classmethod
    def load(cls, store_dir: Path | None = None) -> "FeatureStore":
        d = store_dir or config.STORE_DIR
        return cls(
            players=pd.read_parquet(d / "players.parquet"),
            team_allowed=pd.read_parquet(d / "team_allowed.parquet"),
            team_own=pd.read_parquet(d / "team_own.parquet"),
            player_vectors=pd.read_parquet(d / "player_vectors.parquet"),
            team_allowed_vectors=pd.read_parquet(d / "team_allowed_vectors.parquet"),
            team_own_vectors=pd.read_parquet(d / "team_own_vectors.parquet"),
        )

    # --- nightly update (b2: append raw rows, recompute affected) ----------

    def update_with_nightly_results(
        self, new_player_games: pd.DataFrame, new_team_games: pd.DataFrame
    ) -> None:
        """Ingest one night's raw results and recompute affected vectors.

        ``new_player_games`` has the player game-log schema; ``new_team_games`` the
        team game-log schema (both teams of each game present, so the opponent
        self-join is self-contained for the batch).
        """
        new_player_games = rdata._to_datetime(new_player_games)
        new_team_games = rdata._to_datetime(new_team_games)

        self.players = _append_dedup(self.players, new_player_games, ["PLAYER_ID", "GAME_ID"])
        self.team_allowed = _append_dedup(
            self.team_allowed, rdata.build_team_allowed(new_team_games), ["TEAM_ID", "GAME_ID"]
        )
        self.team_own = _append_dedup(
            self.team_own, rdata.build_team_own(new_team_games), ["TEAM_ID", "GAME_ID"]
        )

        player_ids = new_player_games["PLAYER_ID"].unique().tolist()
        team_ids = new_team_games["TEAM_ID"].unique().tolist()
        self._recompute(player_ids, team_ids)

    def ingest_prederived(
        self,
        player_rows: pd.DataFrame,
        team_allowed_rows: pd.DataFrame,
        team_own_rows: pd.DataFrame,
    ) -> None:
        """Append already-derived rows (player logs + team allowed/own) and recompute.

        Used by the season simulator, which slices these directly from cached frames
        (so it never needs raw team logs). Same b2 semantics as the nightly update.
        """
        self.players = _append_dedup(self.players, player_rows, ["PLAYER_ID", "GAME_ID"])
        self.team_allowed = _append_dedup(self.team_allowed, team_allowed_rows, ["TEAM_ID", "GAME_ID"])
        self.team_own = _append_dedup(self.team_own, team_own_rows, ["TEAM_ID", "GAME_ID"])
        self._recompute(
            player_rows["PLAYER_ID"].unique().tolist(),
            team_allowed_rows["TEAM_ID"].unique().tolist(),
        )

    def _recompute(self, player_ids: list[int], team_ids: list[int]) -> None:
        pv, tav, tov = rfeatures.build_current_state(
            self.players[self.players["PLAYER_ID"].isin(player_ids)],
            self.team_allowed[self.team_allowed["TEAM_ID"].isin(team_ids)],
            self.team_own[self.team_own["TEAM_ID"].isin(team_ids)],
        )
        self.player_vectors = _replace_rows(self.player_vectors, pv, "PLAYER_ID")
        self.team_allowed_vectors = _replace_rows(self.team_allowed_vectors, tav, "TEAM_ID")
        self.team_own_vectors = _replace_rows(self.team_own_vectors, tov, "TEAM_ID")

    # --- reads -------------------------------------------------------------

    def has_player(self, player_id: int) -> bool:
        return player_id in self.player_vectors.index

    def get_player_state(self, player_id: int) -> PlayerState:
        if player_id not in self.player_vectors.index:
            raise UnknownPlayerError(f"player {player_id} is not in the feature store")
        row = self.player_vectors.loc[player_id]
        games = int(row["games_count"])
        if games < config.MIN_INFERENCE_GAMES:
            raise InsufficientHistoryError(player_id, games, config.MIN_INFERENCE_GAMES)
        feature_cols = [c for c in self.player_vectors.columns if c not in _PLAYER_META]
        return PlayerState(
            player_id=player_id,
            team_id=int(row["TEAM_ID"]),
            position=str(row.get("POSITION", "")),
            last_game_date=row["last_game_date"],
            games_count=games,
            vector=row[feature_cols],
        )

    def get_team_state(self, team_id: int) -> TeamState:
        if team_id not in self.team_allowed_vectors.index or team_id not in self.team_own_vectors.index:
            raise UnknownTeamError(f"team {team_id} is not in the feature store")
        allowed = self.team_allowed_vectors.loc[team_id].drop(labels=["TEAM_ID"])
        own = self.team_own_vectors.loc[team_id].drop(labels=["TEAM_ID"])
        return TeamState(team_id=team_id, allowed=allowed, own=own)


# --- helpers ---------------------------------------------------------------

def _append_dedup(base: pd.DataFrame, new: pd.DataFrame, keys: list[str]) -> pd.DataFrame:
    combined = pd.concat([base, new], ignore_index=True)
    return combined.drop_duplicates(subset=keys, keep="last").reset_index(drop=True)


def _replace_rows(indexed: pd.DataFrame, new_rows: pd.DataFrame, key: str) -> pd.DataFrame:
    new_rows = new_rows.set_index(key, drop=False)
    keep = indexed[~indexed.index.isin(new_rows.index)]
    return pd.concat([keep, new_rows])

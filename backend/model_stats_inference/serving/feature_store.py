"""Feature store (design b2): keep raw game rows as the source of truth and
recompute each player's "current-state" feature vector when new results arrive.

No incremental window surgery — recomputing from dated raw rows keeps window
counts, recency caps and the include-last-game rule correct by construction.

Frames are Polars (the web process does not import pandas); the vectors are
built by featurize.py, the bit-identical twin of research/features.py.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

import polars as pl

from ..research import config as rconfig
from . import config, featurize
from .errors import (
    InsufficientHistoryError,
    UnknownPlayerError,
    UnknownTeamError,
)

# Columns on the player vector that are metadata, not model features.
# MIN_LAST5_ALL is the ungated last-5-appearances minutes average, attached at
# store-load time for the slider default — never a model input.
_PLAYER_META = [
    "PLAYER_ID", "PLAYER_NAME", "TEAM_ID", "POSITION", "last_game_date",
    "games_count", "MIN_LAST5_ALL",
]


@dataclass
class PlayerState:
    player_id: int
    team_id: int
    position: str
    last_game_date: date | None
    games_count: int
    features: dict[str, float]  # feature name -> value (history mean/var/rate + efficiency)

    @property
    def vector(self) -> dict[str, float]:
        """Feature name -> value (a copy; the store's dict is shared)."""
        return dict(self.features)


@dataclass
class TeamState:
    team_id: int
    allowed: dict[str, float]  # OPP_ALLOWED_* features
    own: dict[str, float]      # TEAM_* features
    allowed_features: dict[str, float]
    own_features: dict[str, float]


def _float_or_nan(v) -> float:
    return float("nan") if v is None else float(v)


class FeatureStore:
    """Holds raw rows + materialized current-state vectors for players and teams."""

    def __init__(
        self,
        players: pl.DataFrame,
        team_allowed: pl.DataFrame,
        team_own: pl.DataFrame,
        player_vectors: pl.DataFrame,
        team_allowed_vectors: pl.DataFrame,
        team_own_vectors: pl.DataFrame,
    ):
        self.players = players
        self.team_allowed = team_allowed
        self.team_own = team_own
        self.player_vectors = player_vectors
        self.team_allowed_vectors = team_allowed_vectors
        self.team_own_vectors = team_own_vectors
        self._invalidate_read_caches()

    def _invalidate_read_caches(self) -> None:
        """Reset the memoized read views (called whenever vectors change)."""
        self._team_state_cache: dict[int, TeamState] = {}
        self._player_features: dict[int, dict[str, float]] | None = None
        self._player_meta: dict[int, dict] | None = None
        self._player_ids = (
            set(self.player_vectors.get_column("PLAYER_ID").to_list())
            if "PLAYER_ID" in self.player_vectors.columns else set()
        )
        self._allowed_ids = (
            set(self.team_allowed_vectors.get_column("TEAM_ID").to_list())
            if "TEAM_ID" in self.team_allowed_vectors.columns else set()
        )
        self._own_ids = (
            set(self.team_own_vectors.get_column("TEAM_ID").to_list())
            if "TEAM_ID" in self.team_own_vectors.columns else set()
        )

    # --- construction ------------------------------------------------------

    @classmethod
    def build(cls, players, team_allowed, team_own) -> "FeatureStore":
        pv, tav, tov = featurize.build_current_state(players, team_allowed, team_own)
        return cls(players, team_allowed, team_own, pv, tav, tov)

    @classmethod
    def from_research_cache(cls) -> "FeatureStore":
        """Build from the parquet cache produced by the research pipeline."""
        d = rconfig.DATA_DIR
        return cls.build(
            featurize.to_date(pl.read_parquet(d / "players.parquet")),
            featurize.to_date(pl.read_parquet(d / "team_allowed.parquet")),
            featurize.to_date(pl.read_parquet(d / "team_own.parquet")),
        )

    @classmethod
    def from_vectors(
        cls,
        player_vectors: pl.DataFrame,
        team_allowed_vectors: pl.DataFrame,
        team_own_vectors: pl.DataFrame,
    ) -> "FeatureStore":
        """Inference-only store built from materialized vectors (no raw rows).

        Sufficient for ``get_player_state`` / ``get_team_state`` and therefore for
        ``LiveInference`` — but it holds no raw game rows, so it cannot ingest or
        recompute. Used by a live serving path that loads vectors straight from
        the DB instead of rebuilding them from history.
        """
        empty = pl.DataFrame()
        return cls(empty, empty, empty, player_vectors, team_allowed_vectors, team_own_vectors)

    # --- persistence (parquet) ---------------------------------------------

    _FILES = ("players", "team_allowed", "team_own", "player_vectors",
              "team_allowed_vectors", "team_own_vectors")

    def save(self, store_dir: Path | None = None) -> None:
        d = store_dir or config.STORE_DIR
        d.mkdir(parents=True, exist_ok=True)
        for name in self._FILES:
            getattr(self, name).write_parquet(d / f"{name}.parquet")

    @classmethod
    def load(cls, store_dir: Path | None = None) -> "FeatureStore":
        d = store_dir or config.STORE_DIR
        return cls(**{name: pl.read_parquet(d / f"{name}.parquet") for name in cls._FILES})

    # --- nightly update (b2: append raw rows, recompute affected) ----------

    def update_with_nightly_results(
        self, new_player_games: pl.DataFrame, new_team_games: pl.DataFrame
    ) -> None:
        """Ingest one night's raw results and recompute affected vectors.

        ``new_player_games`` has the player game-log schema; ``new_team_games`` the
        team game-log schema (both teams of each game present, so the opponent
        self-join is self-contained for the batch).
        """
        new_player_games = featurize.to_date(new_player_games)
        new_team_games = featurize.to_date(new_team_games)

        self.players = _append_dedup(self.players, new_player_games, ["PLAYER_ID", "GAME_ID"])
        self.team_allowed = _append_dedup(
            self.team_allowed, featurize.build_team_allowed(new_team_games), ["TEAM_ID", "GAME_ID"]
        )
        self.team_own = _append_dedup(
            self.team_own, featurize.build_team_own(new_team_games), ["TEAM_ID", "GAME_ID"]
        )

        player_ids = new_player_games.get_column("PLAYER_ID").unique(maintain_order=True).to_list()
        team_ids = new_team_games.get_column("TEAM_ID").unique(maintain_order=True).to_list()
        self._recompute(player_ids, team_ids)

    def ingest_prederived(
        self,
        player_rows: pl.DataFrame,
        team_allowed_rows: pl.DataFrame,
        team_own_rows: pl.DataFrame,
    ) -> None:
        """Append already-derived rows (player logs + team allowed/own) and recompute.

        Used by the season simulator, which slices these directly from cached frames
        (so it never needs raw team logs). Same b2 semantics as the nightly update.
        """
        self.players = _append_dedup(self.players, player_rows, ["PLAYER_ID", "GAME_ID"])
        self.team_allowed = _append_dedup(self.team_allowed, team_allowed_rows, ["TEAM_ID", "GAME_ID"])
        self.team_own = _append_dedup(self.team_own, team_own_rows, ["TEAM_ID", "GAME_ID"])
        self._recompute(
            player_rows.get_column("PLAYER_ID").unique(maintain_order=True).to_list(),
            team_allowed_rows.get_column("TEAM_ID").unique(maintain_order=True).to_list(),
        )

    def _recompute(self, player_ids: list[int], team_ids: list[int]) -> None:
        pv, tav, tov = featurize.build_current_state(
            self.players.filter(pl.col("PLAYER_ID").is_in(player_ids)),
            self.team_allowed.filter(pl.col("TEAM_ID").is_in(team_ids)),
            self.team_own.filter(pl.col("TEAM_ID").is_in(team_ids)),
            # Team vectors only need the affected teams, but the USG derivation
            # needs pace for every game in these players' histories — including
            # games played for a former club that isn't in `team_ids`.
            pace_source=self.team_own,
        )
        self.player_vectors = _replace_rows(self.player_vectors, pv, "PLAYER_ID")
        self.team_allowed_vectors = _replace_rows(self.team_allowed_vectors, tav, "TEAM_ID")
        self.team_own_vectors = _replace_rows(self.team_own_vectors, tov, "TEAM_ID")
        self._invalidate_read_caches()

    # --- reads -------------------------------------------------------------

    def has_player(self, player_id: int) -> bool:
        return player_id in self._player_ids

    def has_team(self, team_id: int) -> bool:
        """True when the team has an allowed-stats vector (an opponent can be scored)."""
        return team_id in self._allowed_ids

    def get_player_state(self, player_id: int) -> PlayerState:
        if player_id not in self._player_ids:
            raise UnknownPlayerError(f"player {player_id} is not in the feature store")
        if self._player_features is None:
            self._build_read_views()
        meta = self._player_meta[player_id]
        games = int(meta["games_count"])
        if games < config.MIN_INFERENCE_GAMES:
            raise InsufficientHistoryError(player_id, games, config.MIN_INFERENCE_GAMES)
        return PlayerState(
            player_id=player_id,
            team_id=int(meta["TEAM_ID"]),
            position=str(meta.get("POSITION", "") or ""),
            last_game_date=meta["last_game_date"],
            games_count=games,
            features=self._player_features[player_id],
        )

    def player_features(self, player_id: int) -> dict[str, float] | None:
        """The player's feature dict, or None if unknown. Shared, do not mutate."""
        if self._player_features is None:
            self._build_read_views()
        return self._player_features.get(player_id)

    def player_meta(self, player_id: int) -> dict | None:
        """The player's non-feature columns, or None if unknown. Shared, do not mutate."""
        if self._player_meta is None:
            self._build_read_views()
        return self._player_meta.get(player_id)

    def feature_columns(self) -> list[str]:
        return [c for c in self.player_vectors.columns if c not in _PLAYER_META]

    def _build_read_views(self) -> None:
        """Materialize every player's row once, as plain dicts (float features,
        NaN for missing; meta columns as Python values)."""
        pv = self.player_vectors
        feature_cols = self.feature_columns()
        ids = pv.get_column("PLAYER_ID").to_list() if "PLAYER_ID" in pv.columns else []
        feats = pv.select([pl.col(c).cast(pl.Float64).fill_null(float("nan")) for c in feature_cols])
        self._player_features = {
            pid: dict(zip(feature_cols, row)) for pid, row in zip(ids, feats.iter_rows())
        }
        meta_cols = [c for c in _PLAYER_META if c in pv.columns]
        self._player_meta = {
            pid: dict(zip(meta_cols, row)) for pid, row in zip(ids, pv.select(meta_cols).iter_rows())
        }

    def get_team_state(self, team_id: int) -> TeamState:
        cached = self._team_state_cache.get(team_id)
        if cached is not None:
            return cached
        if team_id not in self._allowed_ids or team_id not in self._own_ids:
            raise UnknownTeamError(f"team {team_id} is not in the feature store")
        allowed = _team_row(self.team_allowed_vectors, team_id)
        own = _team_row(self.team_own_vectors, team_id)
        state = TeamState(
            team_id=team_id,
            allowed=allowed,
            own=own,
            allowed_features=allowed,
            own_features=own,
        )
        self._team_state_cache[team_id] = state
        return state


# --- helpers ---------------------------------------------------------------

def _team_row(frame: pl.DataFrame, team_id: int) -> dict[str, float]:
    row = frame.filter(pl.col("TEAM_ID") == team_id).row(0, named=True)
    return {k: _float_or_nan(v) for k, v in row.items() if k != "TEAM_ID"}


def _append_dedup(base: pl.DataFrame, new: pl.DataFrame, keys: list[str]) -> pl.DataFrame:
    if base.width == 0:
        combined = new
    elif new.width == 0:
        combined = base
    else:
        combined = pl.concat([base, new], how="diagonal_relaxed")
    return combined.unique(subset=keys, keep="last", maintain_order=True)


def _replace_rows(indexed: pl.DataFrame, new_rows: pl.DataFrame, key: str) -> pl.DataFrame:
    if indexed.width == 0 or indexed.height == 0:
        return new_rows
    keep = indexed.filter(~pl.col(key).is_in(new_rows.get_column(key).to_list()))
    return pl.concat([keep, new_rows], how="diagonal_relaxed")

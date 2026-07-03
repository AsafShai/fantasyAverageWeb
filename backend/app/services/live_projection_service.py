"""Live per-player next-game projections, served from the resident nightly
feature store (never the historical replay store used by the Simulation page).

Shared by two callers: matchups.py (batch, one predict_many() call for every
player with a game today) and the /projections/predict route (single player,
custom minutes from the UI slider).
"""

from __future__ import annotations

import asyncio
import logging

import numpy as np
import pandas as pd

from app.services.model_nightly_service import ModelNightlyService
from app.services.nba_matchup_service import GameInfo
from app.utils.team_abbr_map import NBA_ABBR_TO_TEAM_ID, espn_to_nba
from model_stats_inference.serving.feature_store import FeatureStore
from model_stats_inference.serving.inference import LiveInference, PredictionRequest

logger = logging.getLogger(__name__)

# A prediction older than this many days since the player's last tracked game
# is flagged amber — the live store has no raw rows (only vectors), so this
# is a coarser proxy for "thin recent form" than Simulation's window-count check.
_STALE_DAYS = 10


class LiveProjectionService:
    """Singleton: holds one warm LiveInference (models loaded once) built from
    ModelNightlyService's resident store, plus a player-name index rebuilt only
    when the underlying store object changes (i.e. after a nightly refresh)."""

    _instance = None
    _inference: LiveInference | None
    _store_ref: FeatureStore | None
    _name_index: dict[str, int]
    _lock: asyncio.Lock

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._inference = None
            cls._instance._store_ref = None
            cls._instance._name_index = {}
            cls._instance._lock = asyncio.Lock()
        return cls._instance

    async def _ensure_inference(self) -> LiveInference | None:
        store = await ModelNightlyService().get_inference_store()
        if store is None:
            return None
        if self._inference is not None and self._store_ref is store:
            return self._inference
        async with self._lock:
            if self._inference is not None and self._store_ref is store:
                return self._inference
            self._inference = await asyncio.to_thread(LiveInference, store)
            self._store_ref = store
            self._name_index = _build_name_index(store)
            return self._inference

    async def project_today(
        self, players_df: pd.DataFrame, games_today: dict[str, GameInfo]
    ) -> dict[str, dict]:
        """player_name -> {default_minutes, status, reason, stats|None} for every
        player with a game today who resolves in the live store."""
        inference = await self._ensure_inference()
        if inference is None or not games_today:
            return {}

        reqs: list[PredictionRequest] = []
        meta: list[tuple[str, int, float]] = []
        today = pd.Timestamp.now().normalize()
        for _, row in players_df.iterrows():
            name = str(row.get('Name', ''))
            info = games_today.get(str(row.get('Pro Team', '')))
            if info is None:
                continue
            pid = self._name_index.get(name)
            if pid is None:
                continue
            opp_id = _opponent_team_id(info.opponent)
            if opp_id is None:
                continue
            default_min = _default_minutes(inference.store, pid)
            reqs.append(PredictionRequest(
                player_id=pid, opponent_team_id=opp_id, is_home=info.is_home,
                game_date=today, minutes=default_min,
            ))
            meta.append((name, pid, default_min))

        if not reqs:
            return {}

        results, errors = await asyncio.to_thread(inference.predict_many, reqs)
        out: dict[str, dict] = {}
        for (name, pid, default_min), res, err in zip(meta, results, errors):
            out[name] = _to_projection(inference.store, pid, default_min, today, res, err)
        return out

    async def project_one(
        self, player_name: str, opponent: str, is_home: bool, minutes: float
    ) -> dict | None:
        """Single re-predicted stat line at custom minutes (slider)."""
        inference = await self._ensure_inference()
        if inference is None:
            return None
        pid = self._name_index.get(player_name)
        if pid is None:
            return None
        opp_id = _opponent_team_id(opponent)
        if opp_id is None:
            return None
        req = PredictionRequest(
            player_id=pid, opponent_team_id=opp_id, is_home=is_home,
            game_date=pd.Timestamp.now().normalize(), minutes=minutes,
        )
        results, errors = await asyncio.to_thread(inference.predict_many, [req])
        if errors[0] is not None:
            return None
        return {'stats': _stat_dict(results[0])}


def _build_name_index(store: FeatureStore) -> dict[str, int]:
    pv = store.player_vectors
    if 'PLAYER_NAME' not in pv.columns:
        return {}
    return {str(name): int(pid) for pid, name in pv['PLAYER_NAME'].items()}


def _opponent_team_id(espn_abbr: str) -> int | None:
    return NBA_ABBR_TO_TEAM_ID.get(espn_to_nba(espn_abbr))


def _default_minutes(store: FeatureStore, player_id: int) -> float:
    if player_id not in store.player_vectors.index:
        return 0.0
    row = store.player_vectors.loc[player_id]
    for col in ('MIN_w5_mean', 'MIN_w10_mean', 'MIN_global_mean'):
        v = row.get(col)
        if v is not None and np.isfinite(v):
            return float(round(v, 1))
    return 0.0


def _stat_dict(result) -> dict[str, float]:
    preds = {k: v.value for k, v in result.stats.items()}
    return {
        'pts': round(preds.get('PTS', 0.0), 1),
        'reb': round(preds.get('REB', 0.0), 1),
        'ast': round(preds.get('AST', 0.0), 1),
        'three_pm': round(preds.get('FG3M', 0.0), 1),
        'stl': round(preds.get('STL', 0.0), 1),
        'blk': round(preds.get('BLK', 0.0), 1),
        'fgm': round(preds.get('FGM', 0.0), 1),
        'fga': round(preds.get('FGA', 0.0), 1),
        'fg_pct': round(preds.get('FG_PCT', 0.0), 3),
        'ftm': round(preds.get('FTM', 0.0), 1),
        'fta': round(preds.get('FTA', 0.0), 1),
        'ft_pct': round(preds.get('FT_PCT', 0.0), 3),
    }


def _to_projection(store: FeatureStore, pid: int, default_min: float, game_date, res, err) -> dict:
    if err is not None:
        return {'default_minutes': default_min, 'status': 'red', 'reason': str(err), 'stats': None}
    status, reason = _freshness(store, pid, game_date)
    return {'default_minutes': default_min, 'status': status, 'reason': reason, 'stats': _stat_dict(res)}


def _freshness(store: FeatureStore, player_id: int, game_date) -> tuple[str, str]:
    """Coarse confidence proxy from the live store's vector metadata (last_game_date)
    — the live store holds no raw rows, so it can't reproduce Simulation's precise
    recent-form window counts. Only called once eligibility (>= MIN_INFERENCE_GAMES)
    is already confirmed by a successful predict."""
    row = store.player_vectors.loc[player_id]
    last = row.get('last_game_date')
    if last is None or pd.isna(last):
        return 'amber', 'no last-game date on record'
    gap = (pd.Timestamp(game_date) - pd.Timestamp(last)).days
    if gap > _STALE_DAYS:
        return 'amber', f'last tracked game {gap} days ago — recent form may be stale'
    return 'green', ''

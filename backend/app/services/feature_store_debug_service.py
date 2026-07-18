"""Read-only inspection of the resident nightly feature store (Feature Store
debug page). Reuses the same store LiveProjectionService predicts from —
no simulator, no replay clock."""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.models.feature_store_models import (
    PlayersListResponse,
    PlayerStoreState,
    PlayerStoreSummary,
    TeamsListResponse,
    TeamStoreState,
    TeamSummary,
)
from app.services.model_nightly_service import ModelNightlyService
from app.utils.team_abbr_map import TEAM_ID_TO_ABBR
from model_stats_inference.serving import config as sconfig
from model_stats_inference.serving.errors import UnknownPlayerError, UnknownTeamError
from model_stats_inference.serving.feature_store import _PLAYER_META, FeatureStore


def _abbr(team_id: int) -> str:
    return TEAM_ID_TO_ABBR.get(team_id, str(team_id))


def _clean(v) -> float | None:
    return None if v is None or (isinstance(v, float) and not np.isfinite(v)) else float(v)


async def _store() -> FeatureStore | None:
    return await ModelNightlyService().get_inference_store()


async def list_players() -> PlayersListResponse:
    store = await _store()
    if store is None:
        return PlayersListResponse(players=[])
    pv = store.player_vectors
    players = [
        PlayerStoreSummary(
            player_id=int(pid),
            player_name=str(row.get('PLAYER_NAME', pid)),
            team_abbr=_abbr(int(row['TEAM_ID'])),
            games_count=int(row['games_count']),
            eligible=int(row['games_count']) >= sconfig.MIN_INFERENCE_GAMES,
        )
        for pid, row in pv.iterrows()
    ]
    players.sort(key=lambda p: p.games_count, reverse=True)
    return PlayersListResponse(players=players)


async def player_state(player_id: int) -> PlayerStoreState:
    store = await _store()
    if store is None or player_id not in store.player_vectors.index:
        raise UnknownPlayerError(f'player {player_id} is not in the feature store')
    row = store.player_vectors.loc[player_id]
    features = {
        col: _clean(row[col]) for col in store.player_vectors.columns if col not in _PLAYER_META
    }
    games = int(row['games_count'])
    last = row.get('last_game_date')
    return PlayerStoreState(
        player_id=player_id,
        player_name=str(row.get('PLAYER_NAME', player_id)),
        team_abbr=_abbr(int(row['TEAM_ID'])),
        position=str(row.get('POSITION', '')),
        last_game_date=None if last is None or pd.isna(last) else str(pd.Timestamp(last).date()),
        games_count=games,
        eligible=games >= sconfig.MIN_INFERENCE_GAMES,
        features=features,
    )


async def list_teams() -> TeamsListResponse:
    store = await _store()
    if store is None:
        return TeamsListResponse(teams=[])
    ids = sorted(int(t) for t in store.team_own_vectors['TEAM_ID'])
    teams = [TeamSummary(team_id=tid, team_abbr=_abbr(tid)) for tid in ids]
    return TeamsListResponse(teams=teams)


async def team_state(team_id: int) -> TeamStoreState:
    store = await _store()
    if store is None:
        raise UnknownTeamError(f'team {team_id} is not in the feature store')
    ts = store.get_team_state(team_id)
    return TeamStoreState(
        team_id=team_id,
        team_abbr=_abbr(team_id),
        own={k: _clean(v) for k, v in ts.own.items()},
        allowed={k: _clean(v) for k, v in ts.allowed.items()},
    )

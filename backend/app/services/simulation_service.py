"""Service wrapping the SeasonSimulator for the debug API.

Singleton: holds one in-memory simulator whose feature store grows as you step
through the season. Heavy CPU work (store build / recompute) is offloaded to a
thread so it doesn't block the event loop.
"""

from __future__ import annotations

import asyncio
import logging

from nba_api.stats.static import teams as static_teams

from app.models.simulation import (
    AdvanceResponse,
    EvalRow,
    Game,
    LastResults,
    PlayerPrediction,
    PlayersListResponse,
    PlayerStoreState,
    PlayerStoreSummary,
    SimState,
    StatCell,
    TeamsListResponse,
    TeamStoreState,
    TeamSummary,
    UpcomingResponse,
)
from model_stats_inference.serving.simulation import REPLAY_SEASON, SeasonSimulator

logger = logging.getLogger(__name__)

_TEAM_ABBR = {t["id"]: t["abbreviation"] for t in static_teams.get_teams()}


def _abbr(team_id: int) -> str:
    return _TEAM_ABBR.get(team_id, str(team_id))


class SimulationService:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._sim = None
            cls._instance._season = REPLAY_SEASON
        return cls._instance

    async def _ensure(self) -> SeasonSimulator:
        if self._sim is None:
            await self.init(self._season)
        return self._sim

    async def init(self, season: str | None = None) -> SimState:
        self._season = season or REPLAY_SEASON
        logger.info("Initializing season simulator for %s", self._season)
        self._sim = await asyncio.to_thread(
            SeasonSimulator.from_research_cache, self._season
        )
        return self._state()

    async def state(self) -> SimState:
        await self._ensure()
        return self._state()

    async def upcoming(self) -> UpcomingResponse:
        sim = await self._ensure()
        preds = await asyncio.to_thread(sim.predict_upcoming)
        last = None
        if sim.last_played_date is not None:
            last = LastResults(
                played_date=sim.last_played_date,
                evaluations=[_eval(e) for e in sim.last_evaluations],
            )
        return UpcomingResponse(
            state=self._state(),
            predictions=[_pred(p) for p in preds],
            last_results=last,
            resid_sigma=dict(sim.inference.resid_sigma),
        )

    async def players(self) -> PlayersListResponse:
        sim = await self._ensure()
        lst = await asyncio.to_thread(sim.list_players)
        st = sim.state()
        return PlayersListResponse(
            current_date=st["current_date"],
            next_game_day=st["next_game_day"],
            players=[
                PlayerStoreSummary(
                    player_id=p["player_id"], player_name=p["player_name"],
                    team_abbr=_abbr(p["team_id"]), games_count=p["games_count"],
                    eligible=p["eligible"],
                )
                for p in lst
            ],
        )

    async def player_state(self, player_id: int) -> PlayerStoreState:
        sim = await self._ensure()
        s = await asyncio.to_thread(sim.player_state, player_id)
        return PlayerStoreState(
            player_id=s["player_id"], player_name=s["player_name"], team_abbr=_abbr(s["team_id"]),
            position=s["position"], last_game_date=s["last_game_date"],
            games_count=s["games_count"], eligible=s["eligible"], features=s["features"],
        )

    async def teams(self) -> TeamsListResponse:
        sim = await self._ensure()
        ids = await asyncio.to_thread(sim.list_teams)
        teams = sorted(
            (TeamSummary(team_id=t, team_abbr=_abbr(t)) for t in ids),
            key=lambda x: x.team_abbr,
        )
        return TeamsListResponse(teams=teams)

    async def team_state(self, team_id: int) -> TeamStoreState:
        sim = await self._ensure()
        s = await asyncio.to_thread(sim.team_state, team_id)
        return TeamStoreState(
            team_id=s["team_id"], team_abbr=_abbr(s["team_id"]),
            own=s["own"], allowed=s["allowed"],
        )

    async def predict_player(self, player_id: int, minutes: float) -> PlayerPrediction:
        sim = await self._ensure()
        pred = await asyncio.to_thread(sim.predict_player, player_id, minutes)
        return _pred(pred)

    async def advance(self) -> AdvanceResponse:
        sim = await self._ensure()
        played = sim.next_game_day
        evals = await asyncio.to_thread(sim.advance)
        from model_stats_inference.serving.simulation import _d
        return AdvanceResponse(
            played_date=_d(played),
            evaluations=[_eval(e) for e in evals],
            state=self._state(),
        )

    def _state(self) -> SimState:
        st = self._sim.state()
        st["games"] = [
            Game(
                game_id=g["game_id"], team_id=g["team_id"], team_abbr=_abbr(g["team_id"]),
                opponent_team_id=g["opponent_team_id"], opponent_abbr=_abbr(g["opponent_team_id"]),
                matchup=g["matchup"],
            )
            for g in st["games"]
        ]
        return SimState(**st)


def _pred(p) -> PlayerPrediction:
    return PlayerPrediction(
        player_id=p.player_id, player_name=p.player_name,
        team_id=p.team_id, team_abbr=_abbr(p.team_id),
        opponent_team_id=p.opponent_team_id, opponent_abbr=_abbr(p.opponent_team_id),
        is_home=p.is_home, minutes=p.minutes, default_minutes=p.default_minutes,
        eligible=p.eligible, status=p.status, reason=p.reason,
        stats={k: StatCell(value=c.value, low=c.low, high=c.high) for k, c in p.stats.items()},
    )


def _eval(e) -> EvalRow:
    return EvalRow(
        player_id=e.player_id, player_name=e.player_name,
        team_abbr=_abbr(e.team_id), opponent_abbr=_abbr(e.opponent_team_id),
        is_home=e.is_home, real_minutes=e.real_minutes,
        eligible=e.eligible, reason=e.reason, predicted=e.predicted, actual=e.actual,
    )

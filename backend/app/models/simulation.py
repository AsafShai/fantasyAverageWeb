"""Pydantic models for the season-simulation debug API."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class StatCell(BaseModel):
    value: float
    low: Optional[float] = None
    high: Optional[float] = None


class Game(BaseModel):
    game_id: str
    team_id: int
    team_abbr: str
    opponent_team_id: int
    opponent_abbr: str
    matchup: str


class SimState(BaseModel):
    season: str
    current_date: Optional[str]
    next_game_day: Optional[str]
    day_index: int
    total_days: int
    finished: bool
    num_games: int
    games: list[Game]


class PlayerPrediction(BaseModel):
    player_id: int
    player_name: str
    team_id: int
    team_abbr: str
    opponent_team_id: int
    opponent_abbr: str
    is_home: bool
    minutes: float
    default_minutes: float
    eligible: bool
    reason: str = ""
    stats: dict[str, StatCell] = {}


class EvalRow(BaseModel):
    player_id: int
    player_name: str
    team_abbr: str
    opponent_abbr: str
    is_home: bool
    real_minutes: float
    eligible: bool
    reason: str = ""
    predicted: dict[str, float] = {}
    actual: dict[str, float] = {}


class LastResults(BaseModel):
    played_date: Optional[str]
    evaluations: list[EvalRow]


class UpcomingResponse(BaseModel):
    state: SimState
    predictions: list[PlayerPrediction]
    last_results: Optional[LastResults] = None


class AdvanceResponse(BaseModel):
    played_date: Optional[str]
    evaluations: list[EvalRow]
    state: SimState


class PlayerStoreSummary(BaseModel):
    player_id: int
    player_name: str
    team_abbr: str
    games_count: int
    eligible: bool


class PlayersListResponse(BaseModel):
    current_date: Optional[str]
    next_game_day: Optional[str]
    players: list[PlayerStoreSummary]


class PlayerStoreState(BaseModel):
    player_id: int
    player_name: str
    team_abbr: str
    position: str
    last_game_date: Optional[str]
    games_count: int
    eligible: bool
    features: dict[str, Optional[float]]


class TeamSummary(BaseModel):
    team_id: int
    team_abbr: str


class TeamsListResponse(BaseModel):
    teams: list[TeamSummary]


class TeamStoreState(BaseModel):
    team_id: int
    team_abbr: str
    own: dict[str, Optional[float]]       # TEAM_* offensive context
    allowed: dict[str, Optional[float]]   # OPP_ALLOWED_* defensive (what they give up)


class InitRequest(BaseModel):
    season: Optional[str] = None


class PredictPlayerRequest(BaseModel):
    player_id: int
    minutes: float

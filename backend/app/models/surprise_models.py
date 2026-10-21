from typing import Optional

from pydantic import BaseModel


class SurpriseReason(BaseModel):
    stat: str
    value: Optional[float] = None
    avg: Optional[float] = None
    z: float


class SurpriseRow(BaseModel):
    player_id: int
    player_name: str
    team_abbr: str
    opponent_abbr: str
    is_home: bool
    minutes: float
    pts: float
    reb: float
    ast: float
    fg3m: float
    stl: float
    blk: float
    fgm: float
    fga: float
    ftm: float
    fta: float
    score: float
    metric_z: Optional[float] = None
    metric_err: Optional[float] = None
    # False: no model estimate yet (fewer than MIN_INFERENCE_GAMES this season),
    # scored on his own history alone.
    has_estimate: bool
    # The server's own call at the default thresholds: 'good' | 'bad' | ''.
    verdict: str
    reasons: list[SurpriseReason]
    # Where he was in the league that night: fantasy team abbrev (None = free
    # agent), the lineup slot, and whether that slot counted (not BE / IR).
    fantasy_team: Optional[str] = None
    lineup_slot: Optional[str] = None
    started: Optional[bool] = None


class SurpriseThresholds(BaseModel):
    good: float
    bad: float


class LatestRun(BaseModel):
    """The nightly's newest ledger row: which night it last handled and how
    ('processed', 'no_games', ...)."""
    game_date: str
    status: str


class NightSurprises(BaseModel):
    latest_run: Optional[LatestRun] = None
    game_date: str
    games: int
    players_played: int
    players_scored: int
    players_with_estimate: int
    # Default thresholds; every scored row is sent and the page filters with its sliders.
    thresholds: SurpriseThresholds
    max_rows: int
    good: list[SurpriseRow]
    bad: list[SurpriseRow]
    computed_at: str

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel


MoveKind = Literal['add', 'drop', 'waiver', 'trade_drop', 'trade']
# on_roster: still there today (season in progress); season_end: there when it ended.
StintExit = Literal['traded', 'released', 'on_roster', 'season_end']


class ActivityTeam(BaseModel):
    team_id: int
    name: str
    abbrev: str


class ActivityPlayer(BaseModel):
    player_id: int
    name: str


class ActivityMove(BaseModel):
    """One line of the league activity feed. For a trade, team_id/added are one
    side and other_team_id/dropped are the other side (what each team received)."""
    id: str
    kind: MoveKind
    at: datetime
    team_id: int
    other_team_id: Optional[int] = None
    trade_id: Optional[str] = None
    added: list[ActivityPlayer]
    dropped: list[ActivityPlayer]


class PickedUpAfter(BaseModel):
    """Where a released player went next: the next fantasy team that rostered him."""
    team_id: int
    date: date
    games_played: int


class StintValue(BaseModel):
    """How a stint's per-game line ranks against the league's player pool over
    the same scoring periods, scored the way Player Rankings scores (z-scores,
    top-300 reference pool, percentages weighted by attempts)."""
    rank: int
    of: int
    z: float
    cat_z: dict[str, float]
    cat_rank: dict[str, int]


class PlayerStint(BaseModel):
    """A player's time on one fantasy roster. Stats are raw totals keyed by
    category code (PTS, REB, FGM, FGA, ...) over the days he was on that roster;
    team_games counts his NBA team's games in the stint, so a gap between it and
    games_played is missed games (injury, rest, DNP)."""
    player_id: int
    name: str
    team_id: int
    start: date
    end: date
    days: int
    games_played: int
    team_games: int
    totals: dict[str, float]
    exit: StintExit
    exit_trade_id: Optional[str] = None
    picked_up_after: Optional[PickedUpAfter] = None
    value: Optional[StintValue] = None


class OpenRosterSpot(BaseModel):
    """The team that received fewer players in an uneven trade, and the free agent
    it picked up without a drop shortly after. Linked by timing alone, so the UI
    leaves it out of trade totals unless the viewer opts in."""
    team_id: int
    added_on: date
    stint: PlayerStint


class TradeSide(BaseModel):
    team_id: int
    received: list[PlayerStint]


class Trade(BaseModel):
    id: str
    date: date
    accepted_at: Optional[datetime] = None
    sides: list[TradeSide]
    released_for_trade: list[ActivityPlayer]
    open_roster_spot: Optional[OpenRosterSpot] = None


class ReleasedPlayer(BaseModel):
    """A player one team released and another later picked up. The stint is the
    new team's, ending at that team's own release (or the season end)."""
    player_id: int
    name: str
    released_by: int
    released_on: date
    games_before_release: int
    stint: PlayerStint


class PendingTradeSide(BaseModel):
    team_id: int
    received: list[ActivityPlayer]


class PendingTrade(BaseModel):
    """A trade both teams accepted that is waiting out the league's review
    period. Nothing has moved yet, so it carries no stints or values; once
    it processes it leaves this list and shows up in ``trades``."""
    id: str
    proposed_by: Optional[int] = None
    proposed_at: Optional[datetime] = None
    accepted_at: Optional[datetime] = None
    processes_at: Optional[datetime] = None
    sides: list[PendingTradeSide]
    # Votes from the other teams (ESPN's "approve" / "veto"), when the league votes.
    approvals: int = 0
    vetoes: int = 0


class LeagueActivity(BaseModel):
    season_id: int
    season_over: bool
    latest_date: Optional[date] = None
    categories: list[str]
    teams: list[ActivityTeam]
    moves: list[ActivityMove]
    trades: list[Trade]
    released: list[ReleasedPlayer]
    pending_trades: list[PendingTrade] = []
    last_updated: datetime


class LatestMoves(BaseModel):
    teams: list[ActivityTeam]
    moves: list[ActivityMove]

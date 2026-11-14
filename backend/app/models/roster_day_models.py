from datetime import date, datetime
from typing import ClassVar, Literal, Optional

from pydantic import BaseModel

from .live import LiveAware, OmitWhenNone

# played: has minutes that day. dnp: his team played and he did not (or, for
# today, his game is over and he did not). scheduled: today, game not started
# or no line yet. no_game: his NBA team was off. live: today, his game is in
# progress (only with LIVE_STANDINGS_ENABLED on; stats are the line so far).
RosterDayStatus = Literal['played', 'dnp', 'scheduled', 'no_game', 'live']
RosterDayGameStatus = Literal['scheduled', 'live', 'final']
RosterDayMoveKind = Literal['free_agent', 'waiver', 'trade']


class RosterDayStats(BaseModel):
    minutes: float = 0
    fgm: float = 0
    fga: float = 0
    ftm: float = 0
    fta: float = 0
    three_pm: float = 0
    reb: float = 0
    ast: float = 0
    stl: float = 0
    blk: float = 0
    pts: float = 0
    to: float = 0


class RosterDayGame(BaseModel):
    """The player's NBA game that day, from the site scoreboard. Final games
    are always sent; scheduled and live ones only with LIVE_STANDINGS_ENABLED
    on. Scores are his team's and the opponent's."""
    status: RosterDayGameStatus
    # The scoreboard's own short text: "Q3 4:12", "Halftime", "Final/OT".
    detail: str = ''
    start_time: Optional[datetime] = None
    team_score: Optional[int] = None
    opp_score: Optional[int] = None
    won: Optional[bool] = None


class RosterDayPlayer(OmitWhenNone):
    omit_when_none: ClassVar[tuple[str, ...]] = ('game',)
    player_id: int
    player_name: str
    positions: list[str]
    pro_team: str
    # The slot he was in when that day's games locked (PG, ..., UTIL, BE, IR).
    lineup_slot: str
    opponent: Optional[str] = None
    status: RosterDayStatus
    stats: Optional[RosterDayStats] = None
    # First / last day on this roster (from that day's and the next day's moves).
    added: bool = False
    dropped: bool = False
    game: Optional[RosterDayGame] = None


class RosterDayMovePlayer(BaseModel):
    player_id: int
    name: str
    # On this team's roster at that day's lock (the UI links it to his row).
    on_roster: bool = False


class RosterDayMove(BaseModel):
    id: str
    kind: RosterDayMoveKind
    at: datetime
    added: list[RosterDayMovePlayer]
    dropped: list[RosterDayMovePlayer]
    # Made after the previous day's lock, so it took effect on this day.
    after_lock: bool = False


class RosterDay(LiveAware):
    team_id: int
    date: date
    scoring_period_id: int
    is_today: bool
    has_games: bool
    # When the day's lineup locked (its first tip-off); None on a day without games.
    lock_at: Optional[datetime] = None
    first_date: date
    last_date: date
    players: list[RosterDayPlayer]
    moves: list[RosterDayMove]

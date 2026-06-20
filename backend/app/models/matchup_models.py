from pydantic import BaseModel


class DefRanks(BaseModel):
    pts: int
    reb: int
    ast: int
    stl: int
    blk: int
    three_pm: int
    fg_pct: int


class DefValues(BaseModel):
    pts: float
    reb: float
    ast: float
    stl: float
    blk: float
    three_pm: float
    fg_pct: float


class PlayerMatchupResponse(BaseModel):
    player_name: str
    pro_team: str
    opponent: str
    pace: float
    league_avg_pace: float
    positions: list[str]
    def_ranks: DefRanks
    def_values: DefValues
    league_avg_def_values: DefValues

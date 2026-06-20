from pydantic import BaseModel


class DefRanks(BaseModel):
    pts: int
    reb: int
    ast: int
    stl: int
    blk: int
    three_pm: int
    fg_pct: int


class PlayerMatchupResponse(BaseModel):
    player_name: str
    pro_team: str
    opponent: str
    pace_badge: str
    def_ranks: DefRanks

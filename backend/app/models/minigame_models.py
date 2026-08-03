from typing import List, Optional

from pydantic import BaseModel, Field


class MinigameLeaderboardRow(BaseModel):
    rank: int
    displayName: str
    bestStreak: int
    hintsUsed: Optional[int] = None


class MinigameLeaderboardResponse(BaseModel):
    rows: List[MinigameLeaderboardRow]


class QualifyRequest(BaseModel):
    bestStreak: int = Field(..., ge=0)
    hintsUsed: Optional[int] = Field(None, ge=0)


class QualifyResponse(BaseModel):
    qualifies: bool


class SubmitLeaderboardRequest(BaseModel):
    displayName: str
    bestStreak: int = Field(..., ge=1)
    hintsUsed: Optional[int] = Field(None, ge=0)


class WhoAmIGuessRequest(BaseModel):
    secretPlayerId: str
    guessPlayerId: str


class NbaTeamOption(BaseModel):
    abbr: str
    label: str

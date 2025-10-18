from pydantic import BaseModel
from typing import List
from .team import Player, Team
from pydantic import Field


class TradeSuggestion(BaseModel):
    opponent_team: Team
    players_to_give: List[Player]
    players_to_receive: List[Player]
    reasoning: str
    
class TradeSuggestionsResponse(BaseModel):
    user_team: Team
    trade_suggestions: List[TradeSuggestion]

class TradeSuggestionAI(BaseModel):
    opponent_team: str = Field(
        description="The team name of the opponent team. This team must actually own the players being received.")
    players_to_give: List[str] = Field(
        description="The list of player names to give to the opponent team. These players must currently be on the requesting team's roster.")
    players_to_receive: List[str] = Field(
        description="The list of player names to receive from the opponent team. Each player must be on the opponent team and not any other")
    reasoning: str = Field(description="The reasoning for the , including what categories each team improves and loses")
    
class TradeSuggestionAIResponse(BaseModel):
    trade_suggestions: List[TradeSuggestionAI] = Field(
        description="The trade suggestions for the user team. Each trade must involve players from the correct teams only.")


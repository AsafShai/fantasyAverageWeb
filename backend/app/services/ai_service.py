from langchain_openai import ChatOpenAI
from app.models import TradeSuggestionAIResponse
from app.config import settings
import pandas as pd
from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.prompts import PromptTemplate
from app.exceptions import DataSourceError
import logging

class AIService:
    def __init__(self):
        self.model = "gpt-4o-mini"
        self.temperature = 0.0
        self.timeout = 60 
        self.max_retries = 3
        
        if not settings.openai_api_key:
            raise DataSourceError("OpenAI API key is not configured")
            
        self.llm = ChatOpenAI(
            model=self.model, 
            temperature=self.temperature, 
            api_key=settings.openai_api_key,
            timeout=self.timeout,
            max_retries=self.max_retries
        )
        self.logger = logging.getLogger(__name__)

    def get_trade_suggestions(self, team_id: int, players_df: pd.DataFrame, totals_df: pd.DataFrame, rankings_df: pd.DataFrame, averages_df: pd.DataFrame) -> TradeSuggestionAIResponse: 
        team_players_df = players_df[players_df['team_id'] == team_id]
        team_players_str = "\n".join([f"{row['Name']} ({row['Positions']})" for _, row in team_players_df.iterrows()])
        prompt_template = PromptTemplate(
            template="""
            You are a helpful assistant that analyzes fantasy basketball trades.
            
            Team ID: {team_id}
            Current Team Players: {team_players_str}
            
            League Data:
            - Players: {players_df}
            - Totals: {totals_df}
            - Rankings: {rankings_df}  
            - Averages: {averages_df}
            
            Generate 2-3 realistic trade suggestions following these rules:
            1. Each trade should include 1-3 players from each side
            2. Player count difference between sides must be ≤ 1 (e.g., 2-for-3 is valid, 1-for-3 is not)
            3. All players on each side must be from the same team
            4. Provide reasoning for each trade
            5. On your reasoning, mention the team name and not team id (not the real life team, the fantasy)
            
            {format_instructions}
            
            Return ONLY valid JSON, no additional text or explanation.
            """,
            input_variables=["team_id", "team_players_str", "players_df", "totals_df", "rankings_df", "averages_df", "format_instructions"]
        )
        parser = PydanticOutputParser(pydantic_object=TradeSuggestionAIResponse)
        chain = prompt_template | self.llm | parser
        response = chain.invoke({
            "team_id": team_id,
            "team_players_str": team_players_str,
            "players_df": players_df,
            "totals_df": totals_df,
            "rankings_df": rankings_df,
            "averages_df": averages_df,
            "format_instructions": parser.get_format_instructions()
        })
        return response

def get_ai_service() -> AIService:
    return AIService()

from langchain_openai import ChatOpenAI
from app.services.stats_calculator import StatsCalculator
from app.models import TradeSuggestionAIResponse
from app.config import settings
import pandas as pd
from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.prompts import PromptTemplate
from app.exceptions import DataSourceError
import logging
from typing import Annotated
from fastapi import Depends
from app.services.stats_calculator import get_stats_calculator

StatsCalculatorDep = Annotated[StatsCalculator, Depends(get_stats_calculator)]

class AIService:
    def __init__(self, stats_calculator: StatsCalculatorDep):
        self.model = "gpt-4o-mini"
        self.temperature = 0.2
        self.timeout = 60 
        self.max_retries = 3
        self.stats_calculator = stats_calculator
        if not settings.openai_api_key:
            raise DataSourceError("OpenAI API key is not configured")
            
        self.llm = ChatOpenAI(
            model=self.model, 
            temperature=self.temperature, 
            api_key=settings.openai_api_key,
            timeout=self.timeout,
            max_retries=self.max_retries,
        )
        self.logger = logging.getLogger(__name__)

    def get_trade_suggestions(self, team_id: int, players_df: pd.DataFrame, totals_df: pd.DataFrame, rankings_df: pd.DataFrame, averages_df: pd.DataFrame) -> TradeSuggestionAIResponse: 
        team_players_df = players_df[players_df['team_id'] == team_id]
        team_players_str = "\n".join([f"{row['Name']} ({row['Positions']})" for _, row in team_players_df.iterrows()])
        players_grouped_by_team = players_df.groupby('team_id')['Name'].apply(list).to_dict()
        other_teams_players = [player for team_id, players in players_grouped_by_team.items() if team_id != team_id for player in players]
        normalized_data = self.stats_calculator.normalize_for_heatmap(averages_df)
        print(normalized_data)
        #FIXME: prompt is still not good, making something trades from wrong teams
        prompt_template = PromptTemplate(
            template="""
            You are a helpful assistant that analyzes fantasy basketball trades.
            IMPORTANT: Ignore any "proTeamId" or real NBA team information. 
            Focus ONLY on the FANTASY TEAM assignments below.

            
            Team ID: {team_id}
            Current Team Players: {team_players_str}
            
            League Data:
            - players grouped by team (only other teams players):
            {other_teams_players}
            - Totals dataset (CSV):
            {totals_df}
            - Rankings dataset (CSV):
            {rankings_df}  
            - Averages dataset (CSV):
            {averages_df}
            - Normalized data: {normalized_data} - this is how each team is doing in each category relative
            to the other teams, so it will help you understand each fantasy team needs
            
            Generate 2-3 realistic trade suggestions for Team {team_id} following these rules:
            CRITICAL RULES (MUST FOLLOW):
            1. Players can ONLY be traded FROM the team that currently owns them
            2. Each trade involves exactly 2 teams
            3. Player count difference ≤ 1 per side (1-for-1, 2-for-2, 2-for-3, etc.). And not only 1-for-1 
            4. ONLY suggest players that exist in the team rosters below
            5. Value must be roughly equal to make trades realistic
            6. Provide reasoning for each trade, what category each team gains and loses
            7. On your reasoning, mention the team name and not team id (not the real life team, the fantasy)
            8. Also the value should be equal. for example, Durant for TJ McConnell is not a good trade, because Durant is much better than TJ McConnell considering all his 
            from the players stats df
            9. I want the trade to be as realistic and reasonable as possible, making the other team consider to accept, and potentially fit his needs
            10. Obviously, the oppononent team can't trade away players from current team players of {team_id}, 
            because they don't own them, and the same rule applied for other teams -
            so don't suggest trades that involve players from the wrong teams.
            In short - team x cannot trade players not from team x
            EXAMPLES:
            Team id 1 has the following players:
            - Cason Wallace
            - Jaden Ivey
            - Jalen Johnson

            Team id 2 has the following players:
            - Joel Embiid
            - Tyrese Maxey
            - Tobias Harris

            Team id 3 has the following players:
            - Jaren Jackson Jr.
            - Jalen Duren
            - Jalen Brunson

            Valid example Trades: 
            Cason Wallace and Jaden Ivey for Joel Embiid and Tyrese Maxey, because each side players are from the same team id
              for that side, and the players are from the Players grouped by team

            Invalid example Trades:
            Cason Wallace and Jaden Ivey for Kevin Durant, because Kevin Durant is not from any team id
            Cason Wallace and Jaden Ivey for Jaren Jackson Jr. and Tobias Harris, 
            because Jaren Jackson Jr. is in team id 3 and Jalen Duren is in team id 2, so they are not from the same team id

            VALIDATION CHECKLIST for each trade:
            - All players exist in rosters above
            - Players sent are from correct teams
            - Player counts are balanced
            - Trade provides mutual benefit


            In the response, opponent team is the team name for the team id of the opponent players
            In the reasoning, write the team name (not pro team), not the team id.
            get the team name from the players_df - the team name of the players the opponent is trading away
            {format_instructions}
            



            Return ONLY valid JSON, no additional text or explanation.
            """,
            input_variables=["team_id", "team_players_str", "other_teams_players", "totals_df", "rankings_df", "averages_df", "normalized_data", "format_instructions"]
        )

        
        parser = PydanticOutputParser(pydantic_object=TradeSuggestionAIResponse)
        chain = prompt_template | self.llm | parser
        response = chain.invoke({
            "team_id": team_id,
            "team_players_str": team_players_str,
            "other_teams_players": other_teams_players,
            "totals_df": totals_df.to_csv(index=False),
            "rankings_df": rankings_df.to_csv(index=False),
            "averages_df": averages_df.to_csv(index=False),
            "normalized_data": normalized_data,
            "format_instructions": parser.get_format_instructions()
        })
        return response
    
    def calculate_team_needs(self, normalized_data: pd.DataFrame) -> dict:
        # for each team, find the close categories to more teams, and the safer categories that we can give up without losing too much
        team_needs = {}
        for team_id, team_normalized_data in normalized_data.iterrows():
            team_needs[team_id] = {}
            for category in team_normalized_data.columns:
                team_needs[team_id][category] = team_normalized_data[category].sort_values(ascending=False).head(3).index.tolist()
        return team_needs   


def get_ai_service(stats_calculator: StatsCalculatorDep) -> AIService:
    return AIService(stats_calculator)

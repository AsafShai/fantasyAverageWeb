import logging
from typing import List
from datetime import datetime
from app.models.fantasy import TeamDetail, TeamPlayers
from app.services.data_provider import DataProvider
from app.builders.response_builder import ResponseBuilder


class TeamService:
    """Service for team-related operations"""
    
    def __init__(self):
        self.data_provider = DataProvider()
        self.response_builder = ResponseBuilder()
        self.logger = logging.getLogger(__name__)
    
    def get_team_detail(self, team_name: str) -> TeamDetail:
        """Get detailed team statistics"""
        espn_data, espn_timestamp = self.data_provider.get_standings_data_with_timestamp()
        if espn_data is None or espn_timestamp is None:
            raise ValueError("Unable to fetch ESPN data")
        
        totals_df, averages_df, rankings_df = self.data_provider.get_all_dataframes(espn_timestamp, espn_data)
        
        if totals_df is None or averages_df is None or rankings_df is None:
            raise ValueError("Unable to process ESPN data")
        
        return self.response_builder.build_team_detail_response(team_name, totals_df, averages_df, rankings_df)
    
    def get_teams_list(self) -> List[str]:
        """Get list of all teams"""
        espn_data, espn_timestamp = self.data_provider.get_standings_data_with_timestamp()
        if espn_data is None or espn_timestamp is None:
            return []
        
        totals_df = self.data_provider.get_totals_df(espn_timestamp, espn_data)
        if totals_df is None:
            return []
        
        return totals_df.index.tolist()
    
    def get_team_players(self, team_name: str) -> TeamPlayers:
        """Get players for a specific team"""
        espn_players_data, espn_players_timestamp = self.data_provider.get_players_data_with_timestamp()
        if espn_players_data is None or espn_players_timestamp is None:
            return TeamPlayers(team=team_name, players=[], last_updated=datetime.now())

        espn_standings_data, espn_standings_timestamp = self.data_provider.get_standings_data_with_timestamp()
        if espn_standings_data is None or espn_standings_timestamp is None:
            return TeamPlayers(team=team_name, players=[], last_updated=datetime.now())
        
        totals_df = self.data_provider.get_totals_df(espn_standings_timestamp, espn_standings_data)
        if totals_df is None:
            return TeamPlayers(team=team_name, players=[], last_updated=datetime.now())

        teams_mapping = {k + 1: v for k, v in enumerate(totals_df.index)}
        players_df = self.data_provider.get_players_df(espn_players_timestamp, espn_players_data, teams_mapping)
        if players_df is None:
            return TeamPlayers(team=team_name, players=[], last_updated=datetime.now())

        team_players = players_df[players_df['Team'] == team_name]
        return self.response_builder.build_team_players_response(team_name, team_players)

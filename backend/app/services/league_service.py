import logging
from datetime import datetime
from app.models.fantasy import LeagueSummary, HeatmapData, LeagueShotsData
from app.services.data_provider import DataProvider
from app.builders.response_builder import ResponseBuilder


class LeagueService:
    """Service for league-wide statistics and analytics operations"""
    
    def __init__(self):
        self.data_provider = DataProvider()
        self.response_builder = ResponseBuilder()
        self.logger = logging.getLogger(__name__)
    
    def get_league_summary(self) -> LeagueSummary:
        """Get league summary statistics"""
        espn_data, espn_timestamp = self.data_provider.get_standings_data_with_timestamp()
        if espn_data is None or espn_timestamp is None:
            return LeagueSummary(
                total_teams=0,
                total_games_played=0,
                category_leaders={},
                league_averages=None,
                last_updated=datetime.now()
            )
        
        averages_df = self.data_provider.get_averages_df(espn_timestamp, espn_data)
        if averages_df is None:
            return LeagueSummary(
                total_teams=0,
                total_games_played=0,
                category_leaders={},
                league_averages=None,
                last_updated=datetime.now()
            )
        
        return self.response_builder.build_league_summary_response(averages_df)
    
    def get_heatmap_data(self) -> HeatmapData:
        """Get data for heatmap visualization"""
        espn_data, espn_timestamp = self.data_provider.get_standings_data_with_timestamp()
        if espn_data is None or espn_timestamp is None:
            return HeatmapData(teams=[], categories=[], data=[], normalized_data=[])
        
        averages_df = self.data_provider.get_averages_df(espn_timestamp, espn_data)
        if averages_df is None:
            return HeatmapData(teams=[], categories=[], data=[], normalized_data=[])
        
        return self.response_builder.build_heatmap_response(averages_df)
    
    def get_league_shots_data(self) -> LeagueShotsData:
        """Get league-wide shooting statistics"""
        espn_data, espn_timestamp = self.data_provider.get_standings_data_with_timestamp()
        if espn_data is None or espn_timestamp is None:
            return LeagueShotsData(shots=[], last_updated=datetime.now())
        
        totals_df = self.data_provider.get_totals_df(espn_timestamp, espn_data)
        if totals_df is None:
            return LeagueShotsData(shots=[], last_updated=datetime.now())
        
        return self.response_builder.build_league_shots_response(totals_df)

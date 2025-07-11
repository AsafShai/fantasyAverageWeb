import logging
from typing import Optional, List, Dict
from datetime import datetime
from app.models.fantasy import LeagueRankings
from app.services.data_provider import DataProvider
from app.builders.response_builder import ResponseBuilder


class RankingService:
    """Service for ranking-related operations"""
    
    def __init__(self):
        self.data_provider = DataProvider()
        self.response_builder = ResponseBuilder()
        self.logger = logging.getLogger(__name__)
    
    def get_rankings(self, sort_by: Optional[str] = None, order: str = "desc") -> LeagueRankings:
        """Get league rankings with optional sorting"""
        espn_data, espn_timestamp = self.data_provider.get_standings_data_with_timestamp()
        if espn_data is None or espn_timestamp is None:
            return LeagueRankings(rankings=[], categories=[], last_updated=datetime.now())
        
        rankings_df = self.data_provider.get_rankings_df(espn_timestamp, espn_data)
        if rankings_df is None:
            return LeagueRankings(rankings=[], categories=[], last_updated=datetime.now())
        
        return self.response_builder.build_rankings_response(rankings_df, sort_by, order)
    
    def get_category_rankings(self, category: str) -> List[Dict]:
        """Get rankings for a specific category"""
        espn_data, espn_timestamp = self.data_provider.get_standings_data_with_timestamp()
        if espn_data is None or espn_timestamp is None:
            return []
        
        averages_df = self.data_provider.get_averages_df(espn_timestamp, espn_data)
        if averages_df is None:
            return []
        
        return self.response_builder.build_category_rankings_response(category, averages_df)

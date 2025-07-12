import logging
from typing import Optional, List, Dict
from app.models import LeagueRankings
from app.services.data_provider import DataProvider
from app.builders.response_builder import ResponseBuilder

class RankingService:
    """Service for ranking-related operations"""
    
    def __init__(self):
        self.data_provider = DataProvider()
        self.response_builder = ResponseBuilder()
        self.logger = logging.getLogger(__name__)
    
    def get_league_rankings(self, sort_by: Optional[str] = None, order: str = "desc") -> LeagueRankings:
        """Get league rankings with optional sorting"""
        rankings_df = self.data_provider.get_rankings_df()
        if rankings_df is None:
            raise Exception("Unable to fetch rankings data from ESPN API")
        
        if sort_by and not self._is_valid_sort_column(sort_by, rankings_df):
            raise ValueError(f"Invalid sort column: {sort_by}")
        
        if order not in ["asc", "desc"]:
            raise ValueError("Order must be 'asc' or 'desc'")
        
        return self.response_builder.build_rankings_response(rankings_df, sort_by, order)
    
    def get_category_rankings(self, category: str) -> List[Dict]:
        """Get rankings for a specific category"""
        averages_df = self.data_provider.get_averages_df()
        if averages_df is None:
            raise Exception("Unable to fetch averages data from ESPN API")
        
        if not self._is_valid_category(category, averages_df):
            raise ValueError(f"Invalid category: {category}")
        
        return self._generate_category_rankings(category, averages_df)
    
    def _is_valid_sort_column(self, sort_by: str, rankings_df) -> bool:
        """Validate if sort column exists in rankings DataFrame"""
        return sort_by in rankings_df.columns
    
    def _is_valid_category(self, category: str, averages_df) -> bool:
        """Validate if category exists in averages DataFrame"""
        return category in averages_df.columns
    
    def _generate_category_rankings(self, category: str, averages_df) -> List[Dict]:
        """Generate rankings for a specific category"""
        return (averages_df.sort_values(category, ascending=False)
                .to_dict('records'))

import logging
from typing import Optional, List, Dict
from app.models import LeagueRankings
from app.exceptions import InvalidParameterError, ResourceNotFoundError
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
            raise ResourceNotFoundError("Unable to fetch rankings data from ESPN API")
        
        if sort_by is not None and not self._is_valid_sort_column(sort_by, rankings_df):
            raise InvalidParameterError(f"Invalid sort column: {sort_by}")
        
        if order not in ["asc", "desc"]:
            raise InvalidParameterError("Order must be 'asc' or 'desc'")
        return self.response_builder.build_rankings_response(rankings_df, sort_by, order)
    
    def _is_valid_sort_column(self, sort_by: str, rankings_df) -> bool:
        """Validate if sort column exists in rankings DataFrame"""
        return sort_by.upper() in rankings_df.columns

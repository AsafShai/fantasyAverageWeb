from datetime import datetime
from typing import Optional, Dict, List
import pandas as pd
from app.models.fantasy import (
    TeamDetail, LeagueRankings, LeagueSummary, HeatmapData
)
from app.services.cache_manager import CacheManager
from app.services.espn_fetcher import ESPNFetcher
from app.services.data_transformer import DataTransformer
from app.services.stats_calculator import StatsCalculator
from app.builders.response_builder import ResponseBuilder

class DataProcessor:
    """Orchestrates ESPN data processing with intelligent caching"""
    
    _instance = None
    _initialized = False
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(DataProcessor, cls).__new__(cls)
        return cls._instance
    
    def __init__(self):
        if not DataProcessor._initialized:
            self.cache_manager = CacheManager()
            self.espn_fetcher = ESPNFetcher()
            self.data_transformer = DataTransformer()
            self.stats_calculator = StatsCalculator()
            self.response_builder = ResponseBuilder()
            DataProcessor._initialized = True
    
    def _get_totals_df(self, espn_timestamp: int, espn_data: Dict) -> Optional[pd.DataFrame]:
        """Get totals DataFrame - simple single responsibility"""
        return self.cache_manager.get_totals(
            espn_timestamp, 
            lambda: self.data_transformer.raw_to_totals_df(espn_data)
        )
    
    def _get_averages_df(self, espn_timestamp: int, espn_data: Dict) -> Optional[pd.DataFrame]:
        """Get averages DataFrame - calculates totals if needed"""
        def calculate_averages():
            totals_df = self._get_totals_df(espn_timestamp, espn_data)
            if totals_df is None:
                return None
            return self.data_transformer.totals_to_averages_df(totals_df)
        
        return self.cache_manager.get_averages(espn_timestamp, calculate_averages)
    
    def _get_rankings_df(self, espn_timestamp: int, espn_data: Dict) -> Optional[pd.DataFrame]:
        """Get rankings DataFrame - calculates averages if needed"""
        def calculate_rankings():
            averages_df = self._get_averages_df(espn_timestamp, espn_data)
            if averages_df is None:
                return None
            return self.data_transformer.averages_to_rankings_df(averages_df)
        
        return self.cache_manager.get_rankings(espn_timestamp, calculate_rankings)
    
    def get_rankings(self, sort_by: Optional[str] = None, order: str = "desc") -> LeagueRankings:
        """Get league rankings with caching"""
        espn_data, espn_timestamp = self.espn_fetcher.fetch_data_with_timestamp()
        if espn_data is None or espn_timestamp is None:
            return LeagueRankings(rankings=[], categories=[], last_updated=datetime.now())
        
        rankings_df = self._get_rankings_df(espn_timestamp, espn_data)
        if rankings_df is None:
            return LeagueRankings(rankings=[], categories=[], last_updated=datetime.now())
        
        return self.response_builder.build_rankings_response(rankings_df, sort_by, order)
    
    def get_category_rankings(self, category: str) -> List[Dict]:
        """Get rankings for a specific category with caching"""
        espn_data, espn_timestamp = self.espn_fetcher.fetch_data_with_timestamp()
        if espn_data is None or espn_timestamp is None:
            return []
        
        averages_df = self._get_averages_df(espn_timestamp, espn_data)
        if averages_df is None:
            return []
        
        return self.response_builder.build_category_rankings_response(category, averages_df)
    
    def get_team_detail(self, team_name: str) -> TeamDetail:
        """Get detailed team statistics with caching"""
        espn_data, espn_timestamp = self.espn_fetcher.fetch_data_with_timestamp()
        if espn_data is None or espn_timestamp is None:
            raise ValueError("Unable to fetch ESPN data")
        
        totals_df = self._get_totals_df(espn_timestamp, espn_data)
        averages_df = self._get_averages_df(espn_timestamp, espn_data)
        rankings_df = self._get_rankings_df(espn_timestamp, espn_data)
        
        if totals_df is None or averages_df is None or rankings_df is None:
            raise ValueError("Unable to process ESPN data")
        
        return self.response_builder.build_team_detail_response(team_name, totals_df, averages_df, rankings_df)
    
    def get_league_summary(self) -> LeagueSummary:
        """Get league summary statistics with caching"""
        espn_data, espn_timestamp = self.espn_fetcher.fetch_data_with_timestamp()
        if espn_data is None or espn_timestamp is None:
            return LeagueSummary(
                total_teams=0,
                total_games_played=0,
                category_leaders={},
                league_averages=None,
                last_updated=datetime.now()
            )
        
        averages_df = self._get_averages_df(espn_timestamp, espn_data)
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
        """Get data formatted for heatmap visualization with caching"""
        espn_data, espn_timestamp = self.espn_fetcher.fetch_data_with_timestamp()
        if espn_data is None or espn_timestamp is None:
            return HeatmapData(teams=[], categories=[], data=[], normalized_data=[])
        
        averages_df = self._get_averages_df(espn_timestamp, espn_data)
        if averages_df is None:
            return HeatmapData(teams=[], categories=[], data=[], normalized_data=[])
        
        return self.response_builder.build_heatmap_response(averages_df)
    
    def get_totals_data(self) -> Dict:
        """Get totals and processed data for debugging purposes with caching"""
        espn_data, espn_timestamp = self.espn_fetcher.fetch_data_with_timestamp()
        if espn_data is None or espn_timestamp is None:
            return {}
        
        # Get all three DataFrames (will use cache if available)
        totals_df = self._get_totals_df(espn_timestamp, espn_data)
        averages_df = self._get_averages_df(espn_timestamp, espn_data)
        rankings_df = self._get_rankings_df(espn_timestamp, espn_data)
        
        if totals_df is None:
            return {}
        
        return self.response_builder.build_totals_response(totals_df, averages_df, rankings_df, espn_timestamp)
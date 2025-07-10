import logging
from typing import Optional, Dict, Tuple
import pandas as pd
from app.services.cache_manager import CacheManager
from app.services.espn_fetcher import ESPNFetcher
from app.services.data_transformer import DataTransformer


class DataProvider:
    """Centralized data provider with caching for all ESPN data operations"""
    
    _instance = None
    _initialized = False
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(DataProvider, cls).__new__(cls)
        return cls._instance
    
    def __init__(self):
        if not DataProvider._initialized:
            self.cache_manager = CacheManager()
            self.espn_fetcher = ESPNFetcher()
            self.data_transformer = DataTransformer()
            self.logger = logging.getLogger(__name__)
            DataProvider._initialized = True
    
    def get_standings_data_with_timestamp(self) -> Tuple[Optional[Dict], Optional[int]]:
        """Get ESPN standings data with timestamp"""
        return self.espn_fetcher.fetch_standings_data_with_timestamp()
    
    def get_players_data_with_timestamp(self) -> Tuple[Optional[Dict], Optional[int]]:
        """Get ESPN players data with timestamp"""
        return self.espn_fetcher.fetch_players_data_with_timestamp()
    
    def get_totals_df(self, espn_timestamp: int, espn_data: Dict) -> Optional[pd.DataFrame]:
        """Get totals DataFrame with caching"""
        return self.cache_manager.get_totals(
            espn_timestamp, 
            lambda: self.data_transformer.raw_standings_to_totals_df(espn_data)
        )
    
    def get_players_df(self, espn_timestamp: int, espn_data: Dict, teams_mapping: Dict) -> Optional[pd.DataFrame]:
        """Get players DataFrame with caching"""
        return self.cache_manager.get_players(
            espn_timestamp, 
            lambda: self.data_transformer.raw_players_to_df(espn_data, teams_mapping)
        )

    def get_averages_df(self, espn_timestamp: int, espn_data: Dict) -> Optional[pd.DataFrame]:
        """Get averages DataFrame with caching"""
        def calculate_averages():
            totals_df = self.get_totals_df(espn_timestamp, espn_data)
            if totals_df is None:
                return None
            return self.data_transformer.totals_to_averages_df(totals_df)
        
        return self.cache_manager.get_averages(espn_timestamp, calculate_averages)
    
    def get_rankings_df(self, espn_timestamp: int, espn_data: Dict) -> Optional[pd.DataFrame]:
        """Get rankings DataFrame with caching"""
        def calculate_rankings():
            averages_df = self.get_averages_df(espn_timestamp, espn_data)
            if averages_df is None:
                return None
            return self.data_transformer.averages_to_rankings_df(averages_df)
        
        return self.cache_manager.get_rankings(espn_timestamp, calculate_rankings)
    
    def get_all_dataframes(self, espn_timestamp: int, espn_data: Dict) -> Tuple[Optional[pd.DataFrame], Optional[pd.DataFrame], Optional[pd.DataFrame]]:
        """Get all three main DataFrames at once (optimized for endpoints that need multiple)"""
        totals_df = self.get_totals_df(espn_timestamp, espn_data)
        averages_df = self.get_averages_df(espn_timestamp, espn_data)
        rankings_df = self.get_rankings_df(espn_timestamp, espn_data)
        
        return totals_df, averages_df, rankings_df
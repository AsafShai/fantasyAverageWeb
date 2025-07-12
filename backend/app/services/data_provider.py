import logging
import requests
from typing import Optional, Tuple
import pandas as pd
from app.services.cache_manager import CacheManager
from app.services.data_transformer import DataTransformer
from config import ESPN_STANDINGS_URL, ESPN_PLAYERS_URL


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
            self._validate_urls()
            self.data_transformer = DataTransformer()
            self.logger = logging.getLogger(__name__)
            DataProvider._initialized = True
    
    def get_totals_df(self) -> pd.DataFrame:
        """Get totals DataFrame with caching"""
        try:
            headers = {}
            if self.cache_manager.totals_cache['etag']:
                headers['If-None-Match'] = self.cache_manager.totals_cache['etag']
            
            response = requests.get(ESPN_STANDINGS_URL, headers=headers, timeout=10)
            
            if response.status_code == 304:
                return self.cache_manager.totals_cache['data']
            
            response.raise_for_status()
            api_data = response.json()
            
            # Transform data
            totals_df = self.data_transformer.raw_standings_to_totals_df(api_data)
            
            # Cache the result
            self.cache_manager.totals_cache['etag'] = response.headers.get('ETag')
            self.cache_manager.totals_cache['data'] = totals_df
            
            return totals_df
            
        except requests.RequestException as e:
            self.logger.error(f"Error fetching data from ESPN API: {e}")
            raise Exception("Error fetching data from ESPN API")
        except (KeyError, ValueError) as e:
            self.logger.error(f"Error parsing ESPN API response: {e}")
            raise Exception("Error parsing ESPN API response")
        except Exception as e:
            self.logger.error(f"Unexpected error fetching ESPN data: {e}")
            raise Exception("Unexpected error fetching ESPN data")

    def get_players_df(self) -> pd.DataFrame:
        """Get players DataFrame with caching"""
        try:
            headers = {}
            if self.cache_manager.players_cache['etag']:
                headers['If-None-Match'] = self.cache_manager.players_cache['etag']
            
            response = requests.get(ESPN_PLAYERS_URL, headers=headers, timeout=10)
            
            if response.status_code == 304:
                return self.cache_manager.players_cache['data']
            
            response.raise_for_status()
            api_data = response.json()
            
            # Transform data
            players_df = self.data_transformer.raw_players_to_df(api_data)
            
            # Cache the result
            self.cache_manager.players_cache['etag'] = response.headers.get('ETag')
            self.cache_manager.players_cache['data'] = players_df
            
            return players_df
            
        except requests.RequestException as e:
            self.logger.error(f"Error fetching players data from ESPN API: {e}")
            raise Exception("Error fetching players data from ESPN API")
        except (KeyError, ValueError) as e:
            self.logger.error(f"Error parsing ESPN API response: {e}")
            raise Exception("Error parsing ESPN API response")
        except Exception as e:
            self.logger.error(f"Unexpected error fetching ESPN players data: {e}")
            raise Exception("Unexpected error fetching ESPN players data")

    def get_averages_df(self) -> pd.DataFrame:
        """Get averages DataFrame with caching"""
        totals_df = self.get_totals_df()
        return self.data_transformer.totals_to_averages_df(totals_df)
    
    def get_rankings_df(self) -> pd.DataFrame:
        """Get rankings DataFrame with caching"""
        averages_df = self.get_averages_df()
        return self.data_transformer.averages_to_rankings_df(averages_df)
    
    def get_all_dataframes(self) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
        """Get all three main DataFrames at once (optimized for endpoints that need multiple)"""
        totals_df = self.get_totals_df()
        averages_df = self.get_averages_df()
        rankings_df = self.get_rankings_df()
        
        return totals_df, averages_df, rankings_df
    
    def _validate_urls(self):
        """Validate that required URLs are configured"""
        if not ESPN_STANDINGS_URL:
            raise ValueError("ESPN_STANDINGS_URL is not configured")
        if not ESPN_PLAYERS_URL:
            raise ValueError("ESPN_PLAYERS_URL is not configured")
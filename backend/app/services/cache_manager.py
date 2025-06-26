import pandas as pd
from typing import Optional, Dict
import threading


class CacheManager:
    """Per-DataFrame cache with timestamp validation"""
    
    _instance = None
    _lock = threading.Lock()
    
    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super(CacheManager, cls).__new__(cls)
                    cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if not self._initialized:
            # Cache each DataFrame with its own timestamp
            self.totals_cache: Dict = {'timestamp': None, 'data': None}
            self.averages_cache: Dict = {'timestamp': None, 'data': None}
            self.rankings_cache: Dict = {'timestamp': None, 'data': None}
            self._initialized = True
    
    def get_totals(self, current_timestamp: int, calculator_func) -> Optional[pd.DataFrame]:
        """Get totals DataFrame from cache or calculate and cache it"""
        if (self.totals_cache['timestamp'] == current_timestamp and 
            self.totals_cache['data'] is not None):
            return self.totals_cache['data']
        
        # Calculate fresh and cache
        totals_df = calculator_func()
        if totals_df is not None:
            self.totals_cache = {
                'timestamp': current_timestamp,
                'data': totals_df.copy()
            }
        return totals_df
    
    def get_averages(self, current_timestamp: int, calculator_func) -> Optional[pd.DataFrame]:
        """Get averages DataFrame from cache or calculate and cache it"""
        if (self.averages_cache['timestamp'] == current_timestamp and 
            self.averages_cache['data'] is not None):
            return self.averages_cache['data']
        
        # Calculate fresh and cache
        averages_df = calculator_func()
        if averages_df is not None:
            self.averages_cache = {
                'timestamp': current_timestamp,
                'data': averages_df.copy()
            }
        return averages_df
    
    def get_rankings(self, current_timestamp: int, calculator_func) -> Optional[pd.DataFrame]:
        """Get rankings DataFrame from cache or calculate and cache it"""
        if (self.rankings_cache['timestamp'] == current_timestamp and 
            self.rankings_cache['data'] is not None):
            return self.rankings_cache['data']
        
        # Calculate fresh and cache
        rankings_df = calculator_func()
        if rankings_df is not None:
            self.rankings_cache = {
                'timestamp': current_timestamp,
                'data': rankings_df.copy()
            }
        return rankings_df
    
    def invalidate_cache(self):
        """Clear all cached data"""
        self.totals_cache = {'timestamp': None, 'data': None}
        self.averages_cache = {'timestamp': None, 'data': None}
        self.rankings_cache = {'timestamp': None, 'data': None}
    
    def get_cache_info(self) -> dict:
        """Get cache status information"""
        return {
            'totals_timestamp': self.totals_cache['timestamp'],
            'averages_timestamp': self.averages_cache['timestamp'],
            'rankings_timestamp': self.rankings_cache['timestamp'],
            'has_totals': self.totals_cache['data'] is not None,
            'has_averages': self.averages_cache['data'] is not None,
            'has_rankings': self.rankings_cache['data'] is not None
        }
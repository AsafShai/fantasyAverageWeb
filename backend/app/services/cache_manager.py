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
            self.totals_cache: Dict = {'etag': None, 'data': None}
            self.players_cache: Dict = {'etag': None, 'data': None}
            self._initialized = True
    
    def get_totals(self, etag: str, calculator_func) -> Optional[pd.DataFrame]:
        """Get totals DataFrame from cache or calculate and cache it"""
        if (self.totals_cache['etag'] == etag and 
            self.totals_cache['data'] is not None):
            return self.totals_cache['data']
        
        # Calculate fresh and cache
        totals_df = calculator_func()
        if totals_df is not None:
            self.totals_cache = {
                'etag': etag,
                'data': totals_df.copy()
            }
        return totals_df
    
    def get_players(self, etag: str, calculator_func) -> Optional[pd.DataFrame]:
        if (self.players_cache['etag'] == etag and 
            self.players_cache['data'] is not None):
            return self.players_cache['data']
        
        # Calculate fresh and cache
        players_df = calculator_func()
        if players_df is not None:
            self.players_cache = {
                'etag': etag,
                'data': players_df.copy()
            }
        return players_df
    
    def invalidate_cache(self):
        """Clear all cached data"""
        self.totals_cache = {'etag': None, 'data': None}
        self.players_cache = {'etag': None, 'data': None}

    def get_cache_info(self) -> dict:
        """Get cache status information"""
        return {
            'totals_etag': self.totals_cache['etag'],
            'players_etag': self.players_cache['etag'],
            'has_totals': self.totals_cache['data'] is not None,
            'has_players': self.players_cache['data'] is not None
        }
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
            self.draft_detail_cache: Optional[Dict] = None
            self.players_directory_cache: Optional[Dict[int, str]] = None
            self._initialized = True
    
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
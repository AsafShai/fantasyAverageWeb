import requests
import logging
import time
from typing import Optional, Dict, Tuple
from config import ESPN_STANDINGS_URL, ESPN_PLAYERS_URL


class ESPNFetcher:
    """Handles ESPN API data fetching and timestamp extraction"""
    
    def __init__(self):
        self._espn_standings_url = ESPN_STANDINGS_URL
        self._espn_players_url = ESPN_PLAYERS_URL
        self.logger = logging.getLogger(__name__)
    

    def fetch_standings_data_with_timestamp(self) -> Tuple[Optional[Dict], Optional[int]]:
        """
        Fetch ESPN API data and extract timestamp
        Returns: (api_data, timestamp) or (None, None) on error
        """
        try:
            if not self._espn_standings_url:
                raise ValueError("ESPN standings URL is not set")
            
            return self.fetch_data_with_timestamp(self._espn_standings_url)
        
        except requests.RequestException as e:
            self.logger.error(f"Error fetching standings data from ESPN API: {e}")
            return None, None


    def fetch_players_data_with_timestamp(self) -> Tuple[Optional[Dict], Optional[int]]:
        """
        Fetch ESPN API data and extract timestamp
        Returns: (api_data, timestamp) or (None, None) on error
        """
        try:
            if not self._espn_players_url:
                raise ValueError("ESPN players URL is not set")
            
            return self.fetch_data_with_timestamp(self._espn_players_url)
        
        except requests.RequestException as e:
            self.logger.error(f"Error fetching players data from ESPN API: {e}")
            return None, None


    def fetch_data_with_timestamp(self, url: str) -> Tuple[Optional[Dict], Optional[int]]:
        """
        Fetch ESPN API data and extract timestamp
        Returns: (api_data, timestamp) or (None, None) on error
        """
        try:
            if not url:
                raise ValueError("ESPN URL is not set")
            
            response = requests.get(url)
            response.raise_for_status()
            api_data = response.json()
            
            # Extract ESPN timestamp (long number)
            timestamp = api_data.get('status', {}).get('standingsUpdateDate')
            
            return api_data, timestamp
            
        except requests.RequestException as e:
            self.logger.error(f"Error fetching data from ESPN API: {e}")
            return None, None
        except (KeyError, ValueError) as e:
            self.logger.error(f"Error parsing ESPN API response: {e}")
            return None, None
        except Exception as e:
            self.logger.error(f"Unexpected error fetching ESPN data: {e}")
            return None, None
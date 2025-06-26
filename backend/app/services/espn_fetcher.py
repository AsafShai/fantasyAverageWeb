import requests
from typing import Optional, Dict, Tuple
from config import ESPN_URL


class ESPNFetcher:
    """Handles ESPN API data fetching and timestamp extraction"""
    
    def __init__(self):
        self._espn_url = ESPN_URL
    
    def fetch_data_with_timestamp(self) -> Tuple[Optional[Dict], Optional[int]]:
        """
        Fetch ESPN API data and extract timestamp
        Returns: (api_data, timestamp) or (None, None) on error
        """
        try:
            response = requests.get(self._espn_url)
            response.raise_for_status()
            api_data = response.json()
            
            # Extract ESPN timestamp (long number)
            timestamp = api_data.get('status', {}).get('standingsUpdateDate')
            
            return api_data, timestamp
            
        except requests.RequestException as e:
            print(f"Error fetching data from ESPN API: {e}")
            return None, None
        except (KeyError, ValueError) as e:
            print(f"Error parsing ESPN API response: {e}")
            return None, None
        except Exception as e:
            print(f"Unexpected error fetching ESPN data: {e}")
            return None, None
    
    def fetch_data(self) -> Optional[Dict]:
        """Fetch ESPN API data only (for backwards compatibility)"""
        api_data, _ = self.fetch_data_with_timestamp()
        return api_data

import logging
import httpx
import json
from typing import Tuple
import pandas as pd
from app.services.cache_manager import CacheManager
from app.services.data_transformer import DataTransformer
from app.config import settings
from app.exceptions import DataSourceError

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
            self.data_transformer = DataTransformer()
            self.logger = logging.getLogger(__name__)
            # Create httpx client with connection pooling
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(30.0, connect=10.0),
                limits=httpx.Limits(max_keepalive_connections=10, max_connections=20)
            )
            DataProvider._initialized = True
            if not settings.season_id or not settings.league_id:
                raise ValueError("Season ID and league ID are not configured")
            self.espn_standings_url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{settings.season_id}/segments/0/leagues/{settings.league_id}?&view=mLiveScoring&view=mTeam'
            self.espn_players_url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{settings.season_id}/segments/0/leagues/{settings.league_id}?view=kona_player_info'
    
    async def get_totals_df(self) -> pd.DataFrame:
        """Get totals DataFrame with caching"""
        try:
            headers = {}
            if self.cache_manager.totals_cache['etag']:
                headers['If-None-Match'] = self.cache_manager.totals_cache['etag']
            
            response = await self._client.get(self.espn_standings_url, headers=headers)
            
            if response.status_code == 304:
                return self.cache_manager.totals_cache['data']
            
            response.raise_for_status()
            api_data = response.json()
            
            totals_df = self.data_transformer.raw_standings_to_totals_df(api_data)
            
            self.cache_manager.totals_cache['etag'] = response.headers.get('ETag')
            self.cache_manager.totals_cache['data'] = totals_df
            
            return totals_df
            
        except httpx.RequestError as e:
            self.logger.error(f"Error fetching data from ESPN API: {e}")
            raise Exception("Error fetching data from ESPN API")
        except (KeyError, ValueError) as e:
            self.logger.error(f"Error parsing ESPN API response: {e}")
            raise Exception("Error parsing ESPN API response")
        except Exception as e:
            self.logger.error(f"Unexpected error fetching ESPN data: {e}")
            raise Exception("Unexpected error fetching ESPN data")

    async def get_players_df(self) -> pd.DataFrame:
        """Get ALL players (roster + FA + waivers) DataFrame with caching"""
        try:
            headers = {}
            if self.cache_manager.players_cache['etag']:
                headers['If-None-Match'] = self.cache_manager.players_cache['etag']

            espn_filter = {
                "players": {
                    "filterStatus": {"value": ["ONTEAM", "FREEAGENT", "WAIVERS"]},
                    "sortPercOwned": {"sortPriority": 1, "sortAsc": False},
                    "limit": 500,
                    "offset": 0
                }
            }
            headers['X-Fantasy-Filter'] = json.dumps(espn_filter)

            response = await self._client.get(self.espn_players_url, headers=headers)

            if response.status_code == 304:
                return self.cache_manager.players_cache['data']

            response.raise_for_status()
            api_data = response.json()

            players_df = self.data_transformer.raw_all_players_to_df(api_data)

            self.cache_manager.players_cache['etag'] = response.headers.get('ETag')
            self.cache_manager.players_cache['data'] = players_df

            return players_df

        except httpx.RequestError as e:
            self.logger.error(f"Error fetching players data from ESPN API: {e}")
            raise DataSourceError("Error fetching players data from ESPN API")
        except (KeyError, ValueError) as e:
            self.logger.error(f"Error parsing ESPN API response: {e}")
            raise DataSourceError("Error parsing ESPN API response")
        except Exception as e:
            self.logger.error(f"Unexpected error fetching ESPN players data: {e}")
            raise DataSourceError("Unexpected error fetching ESPN players data")

    async def get_averages_df(self) -> pd.DataFrame:
        """Get averages DataFrame with caching"""
        totals_df = await self.get_totals_df()
        return self.data_transformer.totals_to_averages_df(totals_df)
    
    async def get_rankings_df(self) -> pd.DataFrame:
        """Get rankings DataFrame with caching"""
        averages_df = await self.get_averages_df()
        return self.data_transformer.averages_to_rankings_df(averages_df)
    
    async def get_all_dataframes(self) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
        """Get all three main DataFrames at once (optimized for endpoints that need multiple)"""
        totals_df = await self.get_totals_df()
        averages_df = self.data_transformer.totals_to_averages_df(totals_df)
        rankings_df = self.data_transformer.averages_to_rankings_df(averages_df)
        
        return totals_df, averages_df, rankings_df
    
    async def close(self):
        """Close the httpx client to clean up connections"""
        if hasattr(self, '_client'):
            await self._client.aclose()

def get_data_provider() -> DataProvider:
    """Factory function for DataProvider dependency injection"""
    return DataProvider()
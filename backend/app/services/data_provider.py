import asyncio
import logging
import httpx
import json
from typing import Dict, Tuple
import pandas as pd
from app.services.cache_manager import CacheManager
from app.services.data_transformer import DataTransformer
from app.services.db_service import DBService
from app.config import settings
from app.exceptions import DataSourceError
from app.utils.constants import RANKING_CATEGORIES

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
            self.db_service = DBService()
            self.logger = logging.getLogger(__name__)
            self._fetch_lock = asyncio.Lock()
            self._db_sync_lock = asyncio.Lock()
            self._last_synced_period = 0
            # Create httpx client with connection pooling
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(30.0, connect=10.0),
                limits=httpx.Limits(max_keepalive_connections=10, max_connections=20)
            )
            DataProvider._initialized = True
            if not settings.season_id or not settings.league_id:
                raise ValueError("Season ID and league ID are not configured")
            self.espn_standings_url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{settings.season_id}/segments/0/leagues/{settings.league_id}?&view=mLiveScoring&view=mTeam&view=mMatchupScore'
            self.espn_players_url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{settings.season_id}/segments/0/leagues/{settings.league_id}?view=kona_player_info'
    
    async def get_totals_df(self) -> pd.DataFrame:
        """Get totals DataFrame with caching. Falls back to DB snapshot on ESPN failure."""
        async with self._fetch_lock:
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

                scoring_period_id = api_data.get('scoringPeriodId', 0)
                self.cache_manager.totals_cache['etag'] = response.headers.get('ETag')
                self.cache_manager.totals_cache['data'] = totals_df
                self.cache_manager.totals_cache['raw'] = api_data
                self.cache_manager.totals_cache['scoring_period_id'] = scoring_period_id
                self.cache_manager.totals_cache['data_date'] = None

                asyncio.create_task(self._sync_db_if_needed(scoring_period_id, totals_df))

                return totals_df

            except Exception as e:
                self.logger.error(f"ESPN fetch failed, attempting DB fallback: {e}")
                if self.cache_manager.totals_cache.get('data') is not None:
                    self.logger.info("Returning in-memory cached data after ESPN failure")
                    return self.cache_manager.totals_cache['data']
                return await self._fallback_from_db()

    async def _fallback_from_db(self) -> pd.DataFrame:
        """Build a totals DataFrame from the latest DB snapshot. Stores data_date in cache."""
        snap_date, rows = await self.db_service.get_latest_snapshot()
        if not rows:
            raise Exception("ESPN unavailable and no DB fallback data found")
        df = pd.DataFrame(rows)
        df = df.rename(columns={
            'fg_pct': 'FG%', 'ft_pct': 'FT%', 'three_pm': '3PM',
            'reb': 'REB', 'ast': 'AST', 'stl': 'STL', 'blk': 'BLK',
            'pts': 'PTS', 'gp': 'GP', 'fgm': 'FGM', 'fga': 'FGA',
            'ftm': 'FTM', 'fta': 'FTA',
        })
        df = df.drop(columns=['date'], errors='ignore')
        self.cache_manager.totals_cache['data'] = df
        self.cache_manager.totals_cache['data_date'] = snap_date
        self.cache_manager.totals_cache['etag'] = None
        self.logger.warning(f"Serving DB fallback data from {snap_date}")
        return df

    async def get_players_df(self, stat_split_type_id: int = 0) -> pd.DataFrame:
        """Get ALL players (roster + FA + waivers) DataFrame with caching

        Args:
            stat_split_type_id: ESPN stat split type (0=season, 1=last7, 2=last15, 3=last30)
        """
        try:
            cache_key = f'players_{stat_split_type_id}'

            if not hasattr(self.cache_manager, cache_key):
                setattr(self.cache_manager, cache_key, {'data': None, 'timestamp': None})

            cache = getattr(self.cache_manager, cache_key)

            if cache.get('data') is not None and cache.get('timestamp'):
                from datetime import datetime, timedelta
                if datetime.now() - cache['timestamp'] < timedelta(minutes=5):
                    return cache['data']

            headers = {}

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
            response.raise_for_status()
            api_data = response.json()

            players_df = self.data_transformer.raw_all_players_to_df(api_data, stat_split_type_id)

            from datetime import datetime
            cache['timestamp'] = datetime.now()
            cache['data'] = players_df

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

    def get_data_date(self):
        """Returns the data_date from cache if serving DB fallback, else None."""
        return self.cache_manager.totals_cache.get('data_date')

    async def get_slot_usage(self) -> Dict[int, Dict[str, int]]:
        """Get games used per roster slot for all teams, parsed from cached mMatchupScore data"""
        await self.get_totals_df()
        raw = self.cache_manager.totals_cache.get('raw')
        if not raw:
            return {}
        return self.data_transformer.parse_slot_usage(raw)

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
    
    async def _sync_db_if_needed(self, scoring_period_id: int, totals_df: pd.DataFrame) -> None:
        completed_period = scoring_period_id - 1
        async with self._db_sync_lock:
            if self._last_synced_period >= completed_period:
                return
            try:
                averages_df = self.data_transformer.totals_to_averages_df(totals_df)
                rankings_avg_df = self.data_transformer.averages_to_rankings_df(averages_df)

                totals_for_ranking = totals_df.drop(['FGM', 'FGA', 'FTM', 'FTA'], axis=1).copy()
                cols_to_keep = ['team_id', 'team_name'] + [c for c in RANKING_CATEGORIES if c in totals_for_ranking.columns] + ['GP']
                totals_for_ranking = totals_for_ranking[[c for c in cols_to_keep if c in totals_for_ranking.columns]]
                rankings_totals_df = self.data_transformer.averages_to_rankings_df(totals_for_ranking)

                max_avg, max_tot, max_snap = await asyncio.gather(
                    self.db_service.get_db_max_scoring_period('team_rankings_averages'),
                    self.db_service.get_db_max_scoring_period('team_rankings_totals'),
                    self.db_service.get_db_max_scoring_period('team_daily_snapshot'),
                )

                tasks = []
                if max_avg < completed_period:
                    tasks.append(self.db_service.upsert_rankings_averages(completed_period, rankings_avg_df))
                if max_tot < completed_period:
                    tasks.append(self.db_service.upsert_rankings_totals(completed_period, rankings_totals_df))
                if max_snap < completed_period:
                    tasks.append(self.db_service.upsert_daily_snapshot(completed_period, totals_df))

                if tasks:
                    await asyncio.gather(*tasks)
                self._last_synced_period = completed_period
            except Exception as e:
                self.logger.error(f"DB sync failed for scoring_period_id={scoring_period_id}: {e}")

    async def close(self):
        """Close the httpx client and DB pool to clean up connections"""
        if hasattr(self, '_client'):
            await self._client.aclose()
        if hasattr(self, 'db_service'):
            await self.db_service.close()

def get_data_provider() -> DataProvider:
    """Factory function for DataProvider dependency injection"""
    return DataProvider()
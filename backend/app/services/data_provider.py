import asyncio
import logging
import httpx
import json
from datetime import datetime, timedelta
from typing import Dict, Optional, Tuple
import pandas as pd
from app.services.cache_manager import CacheManager
from app.services.data_transformer import DataTransformer
from app.services.db_service import DBService
from app.config import settings
from app.exceptions import DataSourceError
from app.utils.constants import RANKING_CATEGORIES
from app.utils import category_storage
from app.utils.category_storage import RANKINGS_FIXED_CATEGORIES, TOTAL_KEY

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
            self._players_inflight: dict[int, asyncio.Future] = {}
            # Create httpx client with connection pooling
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(30.0, connect=10.0),
                limits=httpx.Limits(max_keepalive_connections=10, max_connections=20)
            )
            DataProvider._initialized = True
            if not settings.season_id or not settings.league_id:
                raise ValueError("Season ID and league ID are not configured")
            self.espn_standings_url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{settings.season_id}/segments/0/leagues/{settings.league_id}?&view=mLiveScoring&view=mTeam&view=mMatchupScore&view=mSettings'
            self.espn_players_url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{settings.season_id}/segments/0/leagues/{settings.league_id}?view=kona_player_info'
            self.espn_draft_detail_url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{settings.season_id}/segments/0/leagues/{settings.league_id}?view=mDraftDetail'
            self.espn_players_directory_url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{settings.season_id}/players?view=players_wl'
    
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
                # Cache raw payload before the stats transform, which can fail on its
                # own (e.g. preseason: teams exist but carry no valuesByStat yet) —
                # get_team_names_df() still needs team identity from this same fetch.
                self.cache_manager.totals_cache['raw'] = api_data

                categories = self.data_transformer.resolve_ranking_categories(api_data)
                totals_df = self.data_transformer.raw_standings_to_totals_df(api_data, categories)

                scoring_period_id = api_data.get('scoringPeriodId', 0)
                self.cache_manager.totals_cache['etag'] = response.headers.get('ETag')
                self.cache_manager.totals_cache['data'] = totals_df
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

    async def sync_db_now(self) -> bool:
        """Fetch from ESPN and synchronously await the DB sync. Returns True if new data was written."""
        async with self._fetch_lock:
            try:
                response = await self._client.get(self.espn_standings_url)
                response.raise_for_status()
                api_data = response.json()
                categories = self.data_transformer.resolve_ranking_categories(api_data)
                totals_df = self.data_transformer.raw_standings_to_totals_df(api_data, categories)
                scoring_period_id = api_data.get('scoringPeriodId', 0)
                self.cache_manager.totals_cache['etag'] = response.headers.get('ETag')
                self.cache_manager.totals_cache['data'] = totals_df
                self.cache_manager.totals_cache['raw'] = api_data
                self.cache_manager.totals_cache['scoring_period_id'] = scoring_period_id
                self.cache_manager.totals_cache['data_date'] = None
            except Exception as e:
                self.logger.error(f"sync_db_now: ESPN fetch failed: {e}")
                return False

        completed_period = scoring_period_id - 1
        max_snap = await self.db_service.get_db_max_scoring_period(
            'team_daily_snapshot', settings.league_id, settings.season_id
        )
        if max_snap >= completed_period:
            self.logger.info(f"sync_db_now: snapshot already current (period {completed_period}), skipping")
            return False

        await self._sync_db_if_needed(scoring_period_id, totals_df)
        return True

    async def _fallback_from_db(self) -> pd.DataFrame:
        """Build a totals DataFrame from the latest DB snapshot. Stores data_date in cache."""
        snap_date, rows = await self.db_service.get_latest_snapshot(settings.league_id, settings.season_id)
        if not rows:
            raise DataSourceError("ESPN unavailable and no DB fallback data found for this league/season")
        df = pd.DataFrame(rows)
        self.cache_manager.totals_cache['data'] = df
        self.cache_manager.totals_cache['data_date'] = snap_date
        self.cache_manager.totals_cache['etag'] = None
        self.logger.warning(f"Serving DB fallback data from {snap_date}")
        return df

    async def get_team_names(self) -> list:
        """team_id/team_name pairs, independent of whether stat totals exist yet.
        Reuses the raw standings payload already cached by get_totals_df when
        possible; falls back to a fresh fetch only if nothing is cached."""
        raw = self.cache_manager.totals_cache.get('raw')
        if raw is None:
            try:
                response = await self._client.get(self.espn_standings_url)
                response.raise_for_status()
                raw = response.json()
                self.cache_manager.totals_cache['raw'] = raw
            except httpx.RequestError as e:
                self.logger.error(f"Error fetching team names from ESPN API: {e}")
                raise DataSourceError("Error fetching team names from ESPN API")
        return self.data_transformer.raw_standings_to_team_names(raw)

    async def get_players_df(self, stat_split_type_id: int = 0) -> pd.DataFrame:
        """Get ALL players (roster + FA + waivers) DataFrame with caching

        Args:
            stat_split_type_id: ESPN stat split type (0=season, 1=last7, 2=last15, 3=last30)
        """
        try:
            cache_key = f'players_{stat_split_type_id}'

            if not hasattr(self.cache_manager, cache_key):
                setattr(self.cache_manager, cache_key, {'data': None, 'timestamp': None, 'etag': None})

            cache = getattr(self.cache_manager, cache_key)

            if cache.get('data') is not None and cache.get('timestamp'):
                if datetime.now() - cache['timestamp'] < timedelta(minutes=5):
                    return cache['data']

            async def _fetch_and_transform():
                headers = {}

                # ESPN's kona_player_info universe plateaus at ~1069 players (verified
                # 2026-07-11); 1200 covers it with headroom. A lower limit here (this
                # used to be 500) silently drops any player outside the ownership-rank
                # cutoff — including drafted players later dropped to 0% owned, who
                # are still real players with real games (e.g. Reed Sheppard).
                espn_filter = {
                    "players": {
                        "filterStatus": {"value": ["ONTEAM", "FREEAGENT", "WAIVERS"]},
                        "sortPercOwned": {"sortPriority": 1, "sortAsc": False},
                        "limit": 1200,
                        "offset": 0
                    }
                }
                headers['X-Fantasy-Filter'] = json.dumps(espn_filter)
                if cache.get('etag'):
                    headers['If-None-Match'] = cache['etag']

                response = await self._client.get(self.espn_players_url, headers=headers)

                if response.status_code == 304:
                    cache['timestamp'] = datetime.now()
                    return cache['data']

                response.raise_for_status()
                api_data = response.json()

                if self.cache_manager.totals_cache.get('data') is None:
                    # Best-effort only: fantasy_team_name is optional enrichment
                    # (handled below via `if totals_data is not None`) — a totals
                    # failure must not block the players list itself.
                    try:
                        await self.get_totals_df()
                    except Exception as e:
                        self.logger.warning(f"Could not fetch totals for fantasy_team_map: {e}")

                fantasy_team_map = {}
                totals_data = self.cache_manager.totals_cache.get('data')
                if totals_data is not None:
                    fantasy_team_map = dict(zip(totals_data['team_id'], totals_data['team_name']))

                players_df = self.data_transformer.raw_all_players_to_df(api_data, stat_split_type_id, fantasy_team_map)

                cache['etag'] = response.headers.get('ETag')
                cache['timestamp'] = datetime.now()
                cache['data'] = players_df

                return players_df

            return await self._coalesced(self._players_inflight, stat_split_type_id, _fetch_and_transform)

        except httpx.RequestError as e:
            self.logger.error(f"Error fetching players data from ESPN API: {e}")
            raise DataSourceError("Error fetching players data from ESPN API")
        except (KeyError, ValueError) as e:
            self.logger.error(f"Error parsing ESPN API response: {e}")
            raise DataSourceError("Error parsing ESPN API response")
        except Exception as e:
            self.logger.error(f"Unexpected error fetching ESPN players data: {e}")
            raise DataSourceError("Unexpected error fetching ESPN players data")

    @staticmethod
    async def _coalesced(inflight: dict, key, compute):
        """First caller on `key` runs `compute` and registers its Future so
        concurrent callers on the same key await it instead of issuing a
        duplicate ESPN request. The finally block must run even when compute()
        raises — otherwise a failed computation leaves its Future registered
        forever and every later caller on that key awaits a permanently-failed
        Future until process restart."""
        existing = inflight.get(key)
        if existing is not None:
            return await existing

        future: asyncio.Future = asyncio.get_running_loop().create_future()
        inflight[key] = future
        try:
            result = await compute()
        except BaseException as exc:
            future.set_exception(exc)
            future.exception()
            raise
        else:
            future.set_result(result)
            return result
        finally:
            inflight.pop(key, None)

    def get_data_date(self):
        """Returns the data_date from cache if serving DB fallback, else None."""
        return self.cache_manager.totals_cache.get('data_date')

    async def get_draft_detail_raw(self) -> Dict:
        """Get raw ESPN draft picks. Draft is immutable after draft night, cached for process lifetime."""
        if self.cache_manager.draft_detail_cache is not None:
            return self.cache_manager.draft_detail_cache

        try:
            response = await self._client.get(self.espn_draft_detail_url)
            response.raise_for_status()
            api_data = response.json()
            self.cache_manager.draft_detail_cache = api_data
            return api_data
        except httpx.RequestError as e:
            self.logger.error(f"Error fetching draft detail from ESPN API: {e}")
            raise DataSourceError("Error fetching draft detail from ESPN API")

    async def get_players_directory(self) -> Dict[int, str]:
        """Get playerId -> fullName map for the season. Static roster of NBA players, cached for process lifetime."""
        if self.cache_manager.players_directory_cache is not None:
            return self.cache_manager.players_directory_cache

        try:
            headers = {'X-Fantasy-Filter': json.dumps({"players": {"limit": 3000}})}
            response = await self._client.get(self.espn_players_directory_url, headers=headers)
            response.raise_for_status()
            api_data = response.json()
            directory = {p['id']: p['fullName'] for p in api_data}
            self.cache_manager.players_directory_cache = directory
            return directory
        except httpx.RequestError as e:
            self.logger.error(f"Error fetching players directory from ESPN API: {e}")
            raise DataSourceError("Error fetching players directory from ESPN API")

    async def get_slot_usage(self) -> Dict[int, Dict[str, int]]:
        """Get games used per roster slot for all teams, parsed from cached mMatchupScore data"""
        await self.get_totals_df()
        raw = self.cache_manager.totals_cache.get('raw')
        if not raw:
            return {}
        return self.data_transformer.parse_slot_usage(raw)

    async def _settings_payload(self) -> Optional[Dict]:
        """The raw standings payload, which carries the league's scoring settings.

        Warms the cache if a caller hasn't already fetched totals this request:
        the DB-backed date-range paths never do, and reading an unwarmed cache
        silently resolved the historical fixed categories for them. Returns None
        rather than raising when ESPN is unavailable — callers fall back to the
        fixed default, which is the same shape the DB rows are in anyway."""
        raw = self.cache_manager.totals_cache.get('raw')
        if raw:
            return raw
        try:
            await self.get_totals_df()
        except Exception as e:
            self.logger.warning(f"Could not load league settings, using default categories: {e}")
            return None
        return self.cache_manager.totals_cache.get('raw')

    async def get_ranking_categories(self) -> list:
        """Get this league's actual scoring categories, resolved from ESPN's
        settings (falls back to the historical fixed default if unavailable)."""
        raw = await self._settings_payload()
        if not raw:
            return list(RANKING_CATEGORIES)
        return self.data_transformer.resolve_ranking_categories(raw)

    async def get_reverse_categories(self) -> set:
        """Get this league's reverse-scored categories (lower raw value = better,
        e.g. turnovers), resolved from ESPN's settings via each scoringItem's
        isReverseItem flag. Falls back to an empty set (no known reverse
        categories) if settings are unavailable."""
        raw = await self._settings_payload()
        if not raw:
            return set()
        return self.data_transformer.resolve_reverse_categories(raw)

    async def get_averages_df(self) -> pd.DataFrame:
        """Get averages DataFrame with caching"""
        totals_df = await self.get_totals_df()
        categories = await self.get_ranking_categories()
        return self.data_transformer.totals_to_averages_df(totals_df, categories)

    async def get_rankings_df(self) -> pd.DataFrame:
        """Get rankings DataFrame with caching"""
        averages_df = await self.get_averages_df()
        reverse_categories = await self.get_reverse_categories()
        return self.data_transformer.averages_to_rankings_df(averages_df, reverse_categories)

    async def get_all_dataframes(self) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
        """Get all three main DataFrames at once (optimized for endpoints that need multiple)"""
        totals_df = await self.get_totals_df()
        categories = await self.get_ranking_categories()
        reverse_categories = await self.get_reverse_categories()
        averages_df = self.data_transformer.totals_to_averages_df(totals_df, categories)
        rankings_df = self.data_transformer.averages_to_rankings_df(averages_df, reverse_categories)

        return totals_df, averages_df, rankings_df
    
    def _extra_rank_payloads(self, df: pd.DataFrame, categories: list, reverse_categories: set) -> Optional[dict]:
        """{team_id: {category: rank, ..., TOTAL: all-category total}} for the
        categories with no rk_* column, or None when the league scores only the
        fixed ones — which is what keeps the JSONB column NULL and free."""
        extra_cats = [c for c in categories if c not in RANKINGS_FIXED_CATEGORIES and c in df.columns]
        if not extra_cats:
            return None

        cols = ['team_id', 'team_name'] + [c for c in categories if c in df.columns] + ['GP']
        full = self.data_transformer.averages_to_rankings_df(
            df[[c for c in cols if c in df.columns]], reverse_categories
        )
        return {
            int(row['team_id']): {
                **{cat: category_storage.json_safe(row[cat]) for cat in extra_cats},
                TOTAL_KEY: category_storage.json_safe(row['TOTAL_POINTS']),
            }
            for _, row in full.iterrows()
        }

    async def _sync_db_if_needed(self, scoring_period_id: int, totals_df: pd.DataFrame) -> None:
        completed_period = scoring_period_id - 1
        async with self._db_sync_lock:
            if self._last_synced_period >= completed_period:
                return
            try:
                categories = await self.get_ranking_categories()
                reverse_categories = await self.get_reverse_categories()

                averages_df = self.data_transformer.totals_to_averages_df(totals_df, categories)
                # The rk_* columns are fixed at the historical 8, so rank only
                # those for them: rk_total keeps meaning "total over the fixed
                # categories" for every row ever written. Extra categories are
                # ranked separately below and stored as JSONB.
                avg_cols_to_keep = ['team_id', 'team_name'] + [c for c in RANKING_CATEGORIES if c in averages_df.columns] + ['GP']
                averages_for_ranking = averages_df[[c for c in avg_cols_to_keep if c in averages_df.columns]]
                rankings_avg_df = self.data_transformer.averages_to_rankings_df(averages_for_ranking, reverse_categories)

                totals_for_ranking = totals_df.drop(['FGM', 'FGA', 'FTM', 'FTA'], axis=1).copy()
                cols_to_keep = ['team_id', 'team_name'] + [c for c in RANKING_CATEGORIES if c in totals_for_ranking.columns] + ['GP']
                totals_for_ranking = totals_for_ranking[[c for c in cols_to_keep if c in totals_for_ranking.columns]]
                rankings_totals_df = self.data_transformer.averages_to_rankings_df(totals_for_ranking, reverse_categories)

                avg_extras = self._extra_rank_payloads(averages_df, categories, reverse_categories)
                totals_extras = self._extra_rank_payloads(
                    totals_df.drop(['FGM', 'FGA', 'FTM', 'FTA'], axis=1, errors='ignore'),
                    categories, reverse_categories,
                )

                league_id, season_id = settings.league_id, settings.season_id
                max_avg, max_tot, max_snap = await asyncio.gather(
                    self.db_service.get_db_max_scoring_period('team_rankings_averages', league_id, season_id),
                    self.db_service.get_db_max_scoring_period('team_rankings_totals', league_id, season_id),
                    self.db_service.get_db_max_scoring_period('team_daily_snapshot', league_id, season_id),
                )

                tasks = []
                if max_avg < completed_period:
                    tasks.append(self.db_service.upsert_rankings_averages(completed_period, rankings_avg_df, league_id, season_id, avg_extras))
                if max_tot < completed_period:
                    tasks.append(self.db_service.upsert_rankings_totals(completed_period, rankings_totals_df, league_id, season_id, totals_extras))
                if max_snap < completed_period:
                    tasks.append(self.db_service.upsert_daily_snapshot(completed_period, totals_df, league_id, season_id))

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
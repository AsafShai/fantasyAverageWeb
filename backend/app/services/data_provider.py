import asyncio
import logging
import time
import httpx
import json
from datetime import datetime, timedelta
from typing import Dict, Optional, Tuple
import pandas as pd
import pydantic_core
from app.services.cache_manager import CacheManager
from app.services.data_transformer import DataTransformer
from app.services.db_service import DBService
from app.config import settings
from app.exceptions import DataSourceError
from app.utils.constants import RANKING_CATEGORIES
from app.services.data_transformer import ACTUAL_STAT_SOURCE_ID
from app.utils import category_storage
from app.utils.category_storage import RANKINGS_FIXED_CATEGORIES, TOTAL_KEY
from app.utils.ssl_context import shared_ssl_context
from app.utils import background_tasks
from app.services import box_score_service
from app.services import live_overlay as lo
from app.services import live_overlay_service
from app.services.live_overlay_service import LiveOverlayService, LiveState

PRO_TEAM_SCHEDULES_TTL_SECONDS = 24 * 60 * 60
# One page load fans out to several endpoints that all need standings; within
# this window they share one ESPN round trip instead of queueing behind
# _fetch_lock for one request apiece. Only a successful ESPN answer (200/304)
# starts the window, so failures and the DB fallback keep retrying ESPN.
TOTALS_TTL_SECONDS = 30
# Kept short so a lineup move on ESPN shows up quickly: past the TTL the
# request is an ETag revalidation, and ESPN answers an unchanged roster with
# an empty 304, so a short window costs almost nothing.
LINEUP_SLOTS_TTL_SECONDS = 30


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
            self._lineup_slots_lock = asyncio.Lock()
            # Averages/rankings are pure functions of the cached totals frame;
            # see _averages_for / _rankings_for. One slot per mode (official,
            # live), so alternating live and official requests never evict
            # each other.
            self._averages_memo: dict = {}
            self._rankings_memo: dict = {}
            # Built responses per (name, request params, live); see memo_response.
            self._response_memo: dict = {}
            # Live overlay (plans/live_data_updates_design.md): in-memory only.
            self.live = LiveOverlayService()
            self._live_frame_memo: dict = {}
            self._schedule_games_memo: Optional[tuple] = None
            # Create httpx client with connection pooling
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(30.0, connect=10.0),
                limits=httpx.Limits(max_keepalive_connections=10, max_connections=20),
                verify=shared_ssl_context()
            )
            DataProvider._initialized = True
            if not settings.season_id or not settings.league_id:
                raise ValueError("Season ID and league ID are not configured")
            self.espn_standings_url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{settings.season_id}/segments/0/leagues/{settings.league_id}?&view=mLiveScoring&view=mTeam&view=mMatchupScore&view=mSettings'
            self.espn_players_url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{settings.season_id}/segments/0/leagues/{settings.league_id}?view=kona_player_info'
            self.espn_draft_detail_url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{settings.season_id}/segments/0/leagues/{settings.league_id}?view=mDraftDetail'
            self.espn_players_directory_url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{settings.season_id}/players?view=players_wl'
            self.espn_roster_url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{settings.season_id}/segments/0/leagues/{settings.league_id}?view=mRoster'
            self.espn_pro_team_schedules_url = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{settings.season_id}?view=proTeamSchedules_wl'

    async def get_pro_team_schedules(self) -> Dict:
        """Full NBA season schedule for the configured season, in one request.

        Cached for 24h with ETag revalidation; serves the last good payload if
        ESPN fails so the schedule view survives a transient outage."""
        cache = self.cache_manager.pro_team_schedules_cache
        now = time.monotonic()
        if cache['data'] is not None and now - cache['fetched_at'] < PRO_TEAM_SCHEDULES_TTL_SECONDS:
            return cache['data']

        try:
            headers = {}
            if cache['etag']:
                headers['If-None-Match'] = cache['etag']

            response = await self._client.get(self.espn_pro_team_schedules_url, headers=headers)

            if response.status_code == 304 and cache['data'] is not None:
                cache['fetched_at'] = now
                return cache['data']

            response.raise_for_status()
            api_data = response.json()
            cache['etag'] = response.headers.get('ETag')
            cache['data'] = api_data
            cache['fetched_at'] = now
            self.logger.info("ESPN pro-team schedules refreshed (cached for 24h)")
            return api_data
        except Exception as e:
            if cache['data'] is not None:
                self.logger.warning(f"Error fetching pro team schedules from ESPN API, serving last good copy: {type(e).__name__}: {e}")
                return cache['data']
            self.logger.error(f"Error fetching pro team schedules from ESPN API, no cached copy: {type(e).__name__}: {e}")
            raise DataSourceError("Error fetching pro team schedules from ESPN API")


    async def get_totals_df(self, live: bool = False) -> pd.DataFrame:
        """Get totals DataFrame with caching. Falls back to DB snapshot on ESPN failure.

        ``live=True`` adds tonight's games in progress (the totals flavour,
        plan 3.4) when LIVE_STANDINGS_ENABLED is on and guard G1 allows it;
        otherwise, and whenever there is nothing to add, it returns the
        official frame object itself. The live frame is never cached as the
        official one, so the DB sync, estimator and nightly jobs (which never
        pass ``live``) only ever see ESPN's official totals."""
        if live:
            return await self._live_totals(settled=False)
        return await self._official_totals_df()

    async def _official_totals_df(self) -> pd.DataFrame:
        async with self._fetch_lock:
            cache = self.cache_manager.totals_cache
            checked_at = cache.get('espn_checked_at')
            if (
                cache.get('data') is not None
                and checked_at is not None
                and time.monotonic() - checked_at < TOTALS_TTL_SECONDS
            ):
                return cache['data']
            try:
                headers = {}
                if self.cache_manager.totals_cache['etag']:
                    headers['If-None-Match'] = self.cache_manager.totals_cache['etag']

                response = await self._client.get(self.espn_standings_url, headers=headers)

                if response.status_code == 304:
                    self.cache_manager.totals_cache['fetched_at'] = datetime.now()
                    self.cache_manager.totals_cache['espn_checked_at'] = time.monotonic()
                    return self.cache_manager.totals_cache['data']

                response.raise_for_status()
                api_data = response.json()
                # Cache raw payload before the stats transform, which can fail on its
                # own (e.g. preseason: teams exist but carry no valuesByStat yet) —
                # get_team_names_df() still needs team identity from this same fetch.
                self.cache_manager.totals_cache['raw'] = api_data

                categories = self.data_transformer.resolve_ranking_categories(api_data)
                totals_df = self._keep_official_identity(
                    self.data_transformer.raw_standings_to_totals_df(api_data, categories)
                )
                self._observe_live(api_data, totals_df)

                scoring_period_id = api_data.get('scoringPeriodId', 0)
                self.cache_manager.totals_cache['etag'] = response.headers.get('ETag')
                self.cache_manager.totals_cache['data'] = totals_df
                self.cache_manager.totals_cache['scoring_period_id'] = scoring_period_id
                self.cache_manager.totals_cache['data_date'] = None
                self.cache_manager.totals_cache['fetched_at'] = datetime.now()
                self.cache_manager.totals_cache['espn_checked_at'] = time.monotonic()
                self.logger.info(
                    f"ESPN standings refreshed: scoring_period_id={scoring_period_id}, "
                    f"{len(totals_df)} teams, categories={categories}"
                )

                background_tasks.spawn(
                    self._sync_db_if_needed(scoring_period_id, totals_df, self._standings_updated_ms(api_data)),
                    name="standings-db-sync",
                )

                return totals_df

            except Exception as e:
                self.logger.error(f"ESPN standings fetch failed: {type(e).__name__}: {e}")
                if self.cache_manager.totals_cache.get('data') is not None:
                    fetched_at = self.cache_manager.totals_cache.get('fetched_at')
                    self.logger.warning(f"Serving in-memory standings after ESPN failure (last fetched {fetched_at})")
                    return self.cache_manager.totals_cache['data']
                return await self._fallback_from_db()

    async def sync_db_now(self) -> bool:
        """Fetch from ESPN and synchronously await the DB sync. Returns True if new data was written."""
        async with self._fetch_lock:
            try:
                cache = self.cache_manager.totals_cache
                # Conditional only when the cached frame came from ESPN (a DB
                # fallback has no ETag): a 304 keeps that same frame, so the
                # rankings/heatmap built from it stay valid.
                headers = {}
                if cache.get('etag') and cache.get('data') is not None and cache.get('raw') is not None:
                    headers['If-None-Match'] = cache['etag']
                response = await self._client.get(self.espn_standings_url, headers=headers)
                if headers and response.status_code == 304:
                    totals_df = cache['data']
                    scoring_period_id = cache.get('scoring_period_id', cache['raw'].get('scoringPeriodId', 0))
                    cache['fetched_at'] = datetime.now()
                    cache['espn_checked_at'] = time.monotonic()
                else:
                    response.raise_for_status()
                    api_data = response.json()
                    categories = self.data_transformer.resolve_ranking_categories(api_data)
                    totals_df = self._keep_official_identity(
                        self.data_transformer.raw_standings_to_totals_df(api_data, categories)
                    )
                    self._observe_live(api_data, totals_df)
                    scoring_period_id = api_data.get('scoringPeriodId', 0)
                    cache['etag'] = response.headers.get('ETag')
                    cache['data'] = totals_df
                    cache['raw'] = api_data
                    cache['scoring_period_id'] = scoring_period_id
                    cache['data_date'] = None
                    cache['fetched_at'] = datetime.now()
                    cache['espn_checked_at'] = time.monotonic()
            except Exception as e:
                self.logger.error(f"sync_db_now: ESPN fetch failed: {type(e).__name__}: {e}")
                return False

        completed_period = scoring_period_id - 1
        max_snap = await self.db_service.get_db_max_scoring_period(
            'team_daily_snapshot', settings.league_id, settings.season_id
        )
        if max_snap >= completed_period:
            self.logger.info(f"sync_db_now: snapshot already current (period {completed_period}), skipping")
            return False

        written = await self._sync_db_if_needed(
            scoring_period_id, totals_df, self._standings_updated_ms(self.cache_manager.totals_cache.get('raw'))
        )
        return written is not False

    # -- live overlay ----------------------------------------------------------

    def _keep_official_identity(self, totals_df: pd.DataFrame) -> pd.DataFrame:
        """During games the payload changes on every poll while valuesByStat
        does not: keep the cached frame object when the new one is equal, so
        every memo keyed on it (averages, rankings, responses) stays valid."""
        cache = self.cache_manager.totals_cache
        previous = cache.get('data')
        if (
            previous is not None
            and cache.get('data_date') is None
            and isinstance(previous, pd.DataFrame)
            and isinstance(totals_df, pd.DataFrame)
            and previous.equals(totals_df)
        ):
            return previous
        return totals_df

    def _observe_live(self, api_data: Dict, totals_df: pd.DataFrame) -> None:
        """Shadow run, flag on or off: capture tonight's overlay and reconcile
        ESPN's morning update against it (guard G2). Uses the pro-team
        schedule only if it is already cached; never makes a request."""
        cache = self.cache_manager.totals_cache
        previous = cache.get('data')
        previous_from_espn = previous is not None and cache.get('data_date') is None and cache.get('etag') is not None
        schedule_payload = self.cache_manager.pro_team_schedules_cache.get('data')
        schedule = self._games_by_period(schedule_payload) if schedule_payload else None
        self.live.observe(api_data, previous, totals_df, previous_from_espn, schedule)

    @staticmethod
    def _standings_updated_ms(raw: Optional[Dict]) -> Optional[int]:
        try:
            return (raw or {}).get('status', {}).get('standingsUpdateDate')
        except Exception:
            return None

    def _games_by_period(self, payload: Dict) -> Dict[int, Dict[str, int]]:
        memo = self._schedule_games_memo
        if memo is None or memo[0] is not payload:
            memo = (payload, lo.games_by_period(payload))
            self._schedule_games_memo = memo
        return memo[1]

    async def _schedule_games(self) -> Dict[int, Dict[str, int]]:
        return self._games_by_period(await self.get_pro_team_schedules())

    async def _live_context(self):
        """(overlay, tonight's games {game_id: tip ms}) when the overlay may
        be applied: flag on, ESPN (not the DB fallback) serving, something to
        add, and guard G1 passing. None otherwise, meaning "serve official"."""
        if not settings.live_standings_enabled or self.get_data_date() is not None:
            return None
        raw = self.cache_manager.totals_cache.get('raw')
        if not raw:
            return None
        overlay = self.live.overlay_for(raw)
        if overlay.is_empty:
            return None
        schedule = await self._schedule_games()
        if not self.live.check_g1(raw, overlay.period, schedule).ok:
            return None
        return overlay, dict(schedule.get(overlay.period) or {})

    async def _live_totals(self, settled: bool) -> pd.DataFrame:
        """Official totals plus tonight: every started game (``settled``
        False, the totals flavour) or finished games only (``settled`` True,
        what averages are built from). Any failure serves official: live can
        never turn a 200 into a 5xx."""
        official = await self._official_totals_df()
        try:
            ctx = await self._live_context()
            if ctx is None:
                return official
            overlay, games = ctx
            if settled:
                finals = await self.live.final_game_ids(
                    overlay.period, games, box_score_service.scoreboard_for, live_overlay_service._now_ms()
                )
                key = ('settled', overlay.version, finals)
                per_team = overlay.per_team(finals)
            else:
                key = ('progress', overlay.version, None)
                per_team = None
            memo = self._live_frame_memo.get(key[0])
            if memo is not None and memo[0] is official and memo[1] == key:
                return memo[2]
            frame = lo.apply_overlay(official, per_team if per_team is not None else overlay.per_team())
            self._live_frame_memo[key[0]] = (official, key, frame)
            return frame
        except Exception as e:
            self.logger.error(f"Live overlay failed, serving official: {type(e).__name__}: {e}", exc_info=True)
            return official

    async def get_live_state(self, include_finals: bool = False) -> Optional[LiveState]:
        """The ``live`` block for a response, or None while
        LIVE_STANDINGS_ENABLED is off (responses then stay exactly as before).

        ``include_finals`` asks the scoreboard which games are final (plan
        section 2: only for the averages view, only for games 1 h 45 min past
        tip); without it, only finals already known are counted."""
        if not settings.live_standings_enabled:
            return None
        await self._official_totals_df()
        raw = self.cache_manager.totals_cache.get('raw')
        fallback = self.get_data_date() is not None
        updated = None if fallback or not raw else self.data_transformer.resolve_standings_updated_at(raw)

        def inactive(reason, period=None, total=0):
            return LiveState(False, period, None, total, 0, 0, updated, reason)

        if fallback:
            return inactive('serving the DB fallback')
        if not raw:
            return inactive('no standings payload')
        try:
            overlay = self.live.overlay_for(raw)
            schedule = await self._schedule_games()
            games = dict(schedule.get(overlay.period) or {})
            g1 = self.live.check_g1(raw, overlay.period, schedule)
            if not g1.ok:
                return inactive(g1.reason, overlay.period, len(games))
            now = live_overlay_service._now_ms()
            started = {g for g, tip in games.items() if tip <= now} | set(overlay.game_ids)
            if not started:
                return inactive('no game started yet', overlay.period, len(games))
            if include_finals:
                finals = await self.live.final_game_ids(overlay.period, games, box_score_service.scoreboard_for, now)
            else:
                finals = self.live.known_final(overlay.period)
            final_count = len(set(finals) & started)
            return LiveState(
                active=True, period=overlay.period, as_of=overlay.as_of,
                games_total=max(len(games), len(started)),
                games_live=len(started) - final_count, games_final=final_count,
                official_updated_at=updated,
            )
        except Exception as e:
            self.logger.error(f"Live state failed, reporting inactive: {type(e).__name__}: {e}", exc_info=True)
            return inactive('error')

    def live_health(self) -> dict:
        return self.live.status(settings.live_standings_enabled)

    async def _fallback_from_db(self) -> pd.DataFrame:
        """Build a totals DataFrame from the latest DB snapshot. Stores data_date in cache."""
        snap_date, rows = await self.db_service.get_latest_snapshot(settings.league_id, settings.season_id)
        if not rows:
            raise DataSourceError("ESPN unavailable and no DB fallback data found for this league/season")
        df = pd.DataFrame(rows)
        self.cache_manager.totals_cache['data'] = df
        self.cache_manager.totals_cache['data_date'] = snap_date
        self.cache_manager.totals_cache['etag'] = None
        self.cache_manager.totals_cache['fetched_at'] = datetime.now()
        self.cache_manager.totals_cache['espn_checked_at'] = None
        self.logger.warning(f"Serving DB fallback data from {snap_date}")
        return df

    async def get_team_names(self) -> list:
        """team_id/team_name pairs, independent of whether stat totals exist yet.
        Reuses the raw standings payload already cached by get_totals_df when
        possible; falls back to a fresh fetch only if nothing is cached."""
        return self.data_transformer.raw_standings_to_team_names(await self._raw_standings())

    async def get_team_abbrevs(self) -> Dict[int, str]:
        """Current season's fantasy team_id -> abbrev, from the same cached payload."""
        return self.data_transformer.raw_standings_to_team_abbrevs(await self._raw_standings())

    async def _raw_standings(self) -> Dict:
        raw = self.cache_manager.totals_cache.get('raw')
        if raw is None:
            try:
                response = await self._client.get(self.espn_standings_url)
                response.raise_for_status()
                raw = response.json()
                self.cache_manager.totals_cache['raw'] = raw
            except (httpx.HTTPError, ValueError) as e:
                self.logger.error(f"Error fetching team names from ESPN API: {type(e).__name__}: {e}")
                raise DataSourceError("Error fetching team names from ESPN API")
        return raw

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
                    self.logger.debug(f"ESPN players (split={stat_split_type_id}) served from cache")
                    return cache['data']

            async def _fetch_and_transform():
                headers = {}

                # ESPN's kona_player_info universe plateaus at ~1069 players (verified
                # 2026-07-11); 1200 covers it with headroom. A lower limit here (this
                # used to be 500) silently drops any player outside the ownership-rank
                # cutoff — including drafted players later dropped to 0% owned, who
                # are still real players with real games (e.g. Reed Sheppard).
                #
                # Only this split's actual (statSourceId 0) lines are read, so ask ESPN
                # for just those: unfiltered, every player also carries per-game splits
                # and projections — ~25 MB of JSON (vs ~1-2.5 MB) to download and parse
                # on the event loop.
                espn_filter = {
                    "players": {
                        "filterStatus": {"value": ["ONTEAM", "FREEAGENT", "WAIVERS"]},
                        "sortPercOwned": {"sortPriority": 1, "sortAsc": False},
                        "limit": 1200,
                        "offset": 0,
                        "filterStatsForSplitTypeIds": {"value": [stat_split_type_id]},
                        "filterStatsForSourceIds": {"value": [ACTUAL_STAT_SOURCE_ID]},
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
                # ~2.5 MB of JSON: pydantic_core's parser builds the same dict
                # in about half the CPU of response.json().
                api_data = pydantic_core.from_json(response.content)

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

                # get_totals_df above already warmed the standings payload the
                # categories are resolved from, so this costs no extra request.
                categories = await self.get_ranking_categories()
                players_df = self.data_transformer.raw_all_players_to_df(
                    api_data, stat_split_type_id, fantasy_team_map, categories
                )

                # ESPN's payload changes with ownership drift, which the frame
                # doesn't carry, so a new body often yields the same frame. Keep
                # the cached object then: the players list built from it is
                # reused by identity (see PlayerService.get_all_players).
                previous = cache.get('data')
                unchanged = previous is not None and previous.equals(players_df)
                if unchanged:
                    players_df = previous
                cache['etag'] = response.headers.get('ETag')
                cache['timestamp'] = datetime.now()
                cache['data'] = players_df
                self.logger.info(
                    f"ESPN players refreshed: split={stat_split_type_id}, {len(players_df)} players"
                    + (" (unchanged)" if unchanged else "")
                )

                return players_df

            return await self._coalesced(self._players_inflight, stat_split_type_id, _fetch_and_transform)

        except httpx.RequestError as e:
            self.logger.error(f"Error fetching players data from ESPN API (split={stat_split_type_id}): {type(e).__name__}: {e}")
            raise DataSourceError("Error fetching players data from ESPN API")
        except (KeyError, ValueError) as e:
            self.logger.error(f"Error parsing ESPN players response (split={stat_split_type_id}): {type(e).__name__}: {e}", exc_info=True)
            raise DataSourceError("Error parsing ESPN API response")
        except Exception as e:
            self.logger.error(f"Unexpected error fetching ESPN players data (split={stat_split_type_id}): {type(e).__name__}: {e}", exc_info=True)
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
        """Get raw ESPN draft picks. Draft is immutable once ESPN marks it
        drafted, so only then is it cached for process lifetime; before or
        during the draft it is re-fetched so the report never sticks on an
        empty or partial pick list."""
        if self.cache_manager.draft_detail_cache is not None:
            return self.cache_manager.draft_detail_cache

        try:
            response = await self._client.get(self.espn_draft_detail_url)
            response.raise_for_status()
            api_data = response.json()
            if (api_data.get('draftDetail') or {}).get('drafted'):
                self.cache_manager.draft_detail_cache = api_data
                self.logger.info("ESPN draft detail loaded (cached for process lifetime)")
            return api_data
        except httpx.HTTPError as e:
            self.logger.error(f"Error fetching draft detail from ESPN API: {type(e).__name__}: {e}")
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
            self.logger.info(f"ESPN players directory loaded: {len(directory)} players (cached for process lifetime)")
            return directory
        except httpx.HTTPError as e:
            self.logger.error(f"Error fetching players directory from ESPN API: {type(e).__name__}: {e}")
            raise DataSourceError("Error fetching players directory from ESPN API")

    def cached_totals_raw(self) -> Optional[Dict]:
        """The raw totals payload already held for this season, or None."""
        return self.cache_manager.totals_cache.get('raw')

    async def get_slot_usage(self, raw: Optional[Dict] = None, live: bool = False) -> Dict[int, Dict[str, int]]:
        """Get games used per roster slot for all teams, parsed from cached mMatchupScore data.

        Callers that already fetched totals earlier in the same request can pass
        that raw payload to skip a redundant ESPN round trip; omit it (or pass
        None) to revalidate totals first, same as before. ``live=True`` adds
        tonight's games, in progress included, when the overlay applies."""
        if raw is None:
            await self.get_totals_df()
            raw = self.cache_manager.totals_cache.get('raw')
        if not raw:
            return {}
        usage = self.data_transformer.parse_slot_usage(raw)
        if not live:
            return usage
        try:
            ctx = await self._live_context()
            if ctx is None or raw is not self.cache_manager.totals_cache.get('raw'):
                return usage
            overlay = ctx[0]
            out = {team: dict(slots) for team, slots in usage.items()}
            for team, slots in overlay.slot_gp.items():
                if team not in out:
                    continue
                for slot, gp in slots.items():
                    if slot in out[team]:
                        out[team][slot] += gp
            return out
        except Exception as e:
            self.logger.error(f"Live slot usage failed, serving official: {type(e).__name__}: {e}", exc_info=True)
            return usage

    async def get_lineup_slots(self) -> Dict[int, str]:
        """{espn_player_id: current lineup slot label} for every rostered player.

        kona_player_info (the players frame) carries no lineup slot, so this is
        a separate mRoster fetch with its own small cache: only the parsed map
        is kept, never the raw payload. Serves the last good map if ESPN fails,
        and {} if there has never been one -- the slot is display-only."""
        async with self._lineup_slots_lock:
            cache = self.cache_manager.lineup_slots_cache
            now = time.monotonic()
            if cache['data'] is not None and now - cache['fetched_at'] < LINEUP_SLOTS_TTL_SECONDS:
                return cache['data']
            try:
                headers = {}
                if cache['etag'] and cache['data'] is not None:
                    headers['If-None-Match'] = cache['etag']

                response = await self._client.get(self.espn_roster_url, headers=headers)

                if response.status_code == 304 and cache['data'] is not None:
                    cache['fetched_at'] = now
                    return cache['data']

                response.raise_for_status()
                slots = self.data_transformer.parse_lineup_slots(response.json())
                cache['etag'] = response.headers.get('ETag')
                cache['data'] = slots
                cache['fetched_at'] = now
                return slots
            except Exception as e:
                self.logger.warning(f"Lineup slots unavailable: {type(e).__name__}: {e}")
                return cache['data'] if cache['data'] is not None else {}

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
            self.logger.warning(f"Could not load league settings, using default categories: {type(e).__name__}: {e}")
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

    async def get_trade_deadline(self) -> Optional[datetime]:
        """Get this league's trade deadline, resolved from ESPN's settings.
        Returns None if settings are unavailable or the deadline isn't set."""
        raw = await self._settings_payload()
        if not raw:
            return None
        return self.data_transformer.resolve_trade_deadline(raw)

    async def get_standings_updated_at(self) -> Optional[datetime]:
        """When ESPN last updated the league's stats. None while serving the DB
        fallback: the cached payload no longer describes the data served, and
        the "data as of" badge covers that case."""
        raw = await self._settings_payload()
        if not raw or self.get_data_date() is not None:
            return None
        return self.data_transformer.resolve_standings_updated_at(raw)

    # Rankings, heatmap, summary and team pages all rebuild averages/rankings
    # from the same totals frame, which only changes when ESPN returns new
    # standings. Both are pure functions of their inputs, so each is computed
    # once per input and handed out as a copy (callers may modify what they get).
    @staticmethod
    def _mode(live: bool) -> str:
        return 'live' if live else 'official'

    def _averages_for(self, totals_df: pd.DataFrame, categories: list, live: bool = False) -> pd.DataFrame:
        memo = self._averages_memo.get(self._mode(live))
        if memo is None or memo[0] is not totals_df or memo[1] != categories:
            memo = (totals_df, list(categories),
                    self.data_transformer.totals_to_averages_df(totals_df, categories))
            self._averages_memo[self._mode(live)] = memo
        return memo[2]

    def _rankings_for(self, averages_df: pd.DataFrame, reverse_categories: set, live: bool = False) -> pd.DataFrame:
        memo = self._rankings_memo.get(self._mode(live))
        if memo is None or memo[0] is not averages_df or memo[1] != reverse_categories:
            memo = (averages_df, set(reverse_categories),
                    self.data_transformer.averages_to_rankings_df(averages_df, reverse_categories))
            self._rankings_memo[self._mode(live)] = memo
        return memo[2]

    async def _frames_for(self, live: bool) -> tuple:
        """The frames a response is built from: the official totals, or the
        live totals (games in progress) and the live settled totals (finished
        games only, what averages and rankings use)."""
        if not live:
            totals_df = await self.get_totals_df()
            return totals_df, totals_df
        return await self._live_totals(settled=False), await self._live_totals(settled=True)

    async def memo_response(self, name: str, params: tuple, build, live: bool = False):
        """``await build()``, reused until the standings frame or the league's
        categories change: rankings and heatmap are built from nothing else.
        A reused response gets a fresh ``last_updated``, as a rebuild would.

        ``live=True`` keys the memo on the live frames instead; with nothing
        live to add they are the official objects, so the response is the
        same one the official view built."""
        frames = await self._frames_for(live)
        key = (
            tuple(await self.get_ranking_categories()),
            frozenset(await self.get_reverse_categories()),
            self.get_data_date(),
        )
        slot = (name, params, live) if live else (name, params)
        hit = self._response_memo.get(slot)
        if hit is not None and len(hit[0]) == len(frames) and all(a is b for a, b in zip(hit[0], frames)) and hit[1] == key:
            return hit[2].model_copy(update={'last_updated': datetime.now()})
        result = await build()
        self._response_memo[slot] = (frames, key, result)
        return result

    async def get_averages_df(self, live: bool = False) -> pd.DataFrame:
        """Get averages DataFrame with caching. ``live=True`` counts tonight's
        finished games only (plan decision 1)."""
        totals_df = await (self._live_totals(settled=True) if live else self.get_totals_df())
        categories = await self.get_ranking_categories()
        return self._averages_for(totals_df, categories, live).copy()

    async def get_rankings_df(self, live: bool = False) -> pd.DataFrame:
        """Get rankings DataFrame with caching. ``live=True`` ranks the live
        averages (finished games only)."""
        totals_df = await (self._live_totals(settled=True) if live else self.get_totals_df())
        categories = await self.get_ranking_categories()
        averages_df = self._averages_for(totals_df, categories, live)
        reverse_categories = await self.get_reverse_categories()
        return self._rankings_for(averages_df, reverse_categories, live).copy()

    async def get_all_dataframes(self, live: bool = False) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
        """Get all three main DataFrames at once (optimized for endpoints that need multiple).

        ``live=True``: totals include games in progress; averages and
        rankings count finished games only."""
        totals_df, settled_df = await self._frames_for(live)
        categories = await self.get_ranking_categories()
        reverse_categories = await self.get_reverse_categories()
        averages_df = self._averages_for(settled_df, categories, live)
        rankings_df = self._rankings_for(averages_df, reverse_categories, live)

        return totals_df, averages_df.copy(), rankings_df.copy()
    
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

    async def _snapshot_guard(self, completed_period: int, standings_updated_ms: Optional[int]) -> lo.GuardResult:
        """G1 for the DB sync (see live_overlay.snapshot_is_safe). Without the
        schedule it cannot tell and lets the write go ahead, as before."""
        try:
            schedule = await self._schedule_games()
        except Exception as e:
            self.logger.warning(f"DB sync guard: schedule unavailable, writing as before: {type(e).__name__}: {e}")
            return lo.GuardResult(True, "schedule unavailable")
        return lo.snapshot_is_safe(standings_updated_ms, completed_period, schedule)

    async def _sync_db_if_needed(self, scoring_period_id: int, totals_df: pd.DataFrame,
                                 standings_updated_ms: Optional[int] = None) -> Optional[bool]:
        """Write day ``scoring_period_id - 1`` the first time a new period is
        seen. Returns False when guard G1 held the write back (ESPN rolled the
        period before its standings absorbed the finished day); the next
        payload retries."""
        completed_period = scoring_period_id - 1
        async with self._db_sync_lock:
            if self._last_synced_period >= completed_period:
                return None
            guard = await self._snapshot_guard(completed_period, standings_updated_ms)
            if not guard.ok:
                self.logger.warning(f"DB sync held back for period {completed_period}: {guard.reason}")
                return False
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
                    self.logger.info(f"DB sync: writing {len(tasks)} table(s) for completed period {completed_period}")
                    await asyncio.gather(*tasks)
                self._last_synced_period = completed_period
            except Exception as e:
                self.logger.error(f"DB sync failed for scoring_period_id={scoring_period_id}: {type(e).__name__}: {e}", exc_info=True)

    async def close(self):
        """Close the httpx client and DB pool to clean up connections"""
        if hasattr(self, '_client'):
            await self._client.aclose()
        if hasattr(self, 'db_service'):
            await self.db_service.close()

def get_data_provider() -> DataProvider:
    """Factory function for DataProvider dependency injection"""
    return DataProvider()
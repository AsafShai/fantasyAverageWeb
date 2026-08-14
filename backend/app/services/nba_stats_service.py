import asyncio
import httpx
from typing import Optional
from datetime import datetime, timedelta
import logging

_CACHE_TTL = timedelta(minutes=30)


class NBAStatsService:
    """Service for fetching NBA league-wide statistics from ESPN APIs.

    Singleton (like DataProvider) so its pooled httpx client is reused across
    requests instead of a fresh connection pool per Dashboard load."""

    _instance = None
    _initialized = False

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        if NBAStatsService._initialized:
            return
        self.logger = logging.getLogger(__name__)
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(30.0, connect=10.0),
            limits=httpx.Limits(max_keepalive_connections=10, max_connections=20)
        )
        self._pace_cache: dict = {'season_id': None, 'value': None, 'ts': None}
        self._days_left_cache: dict = {'season_id': None, 'value': None, 'ts': None}
        NBAStatsService._initialized = True

    async def get_nba_average_pace(self, season_id: int) -> Optional[float]:
        """
        Get average games played per NBA team from standings, cached 30 min
        (moves at most once/day; polled on every Dashboard load otherwise).

        Args:
            season_id: NBA season year (e.g., 2026)

        Returns:
            Average games played across all 30 NBA teams, or None if fetch fails
        """
        cache = self._pace_cache
        if (
            cache['season_id'] == season_id
            and cache['ts'] is not None
            and datetime.now() - cache['ts'] < _CACHE_TTL
        ):
            return cache['value']

        value = await self._fetch_nba_average_pace(season_id)
        self._pace_cache = {'season_id': season_id, 'value': value, 'ts': datetime.now()}
        return value

    async def _fetch_nba_average_pace(self, season_id: int) -> Optional[float]:
        try:
            url = f"https://site.api.espn.com/apis/v2/sports/basketball/nba/standings?season={season_id}"
            response = await self._client.get(url)
            response.raise_for_status()
            data = response.json()

            all_entries = [
                entry
                for conf in data.get('children', [])
                for entry in conf.get('standings', {}).get('entries', [])
            ]

            if not all_entries:
                self.logger.warning("No standings entries found in NBA API response")
                return None

            games_played_list = []
            for entry in all_entries:
                stats = entry.get('stats', [])

                stats_map = {s['name']: s.get('value') for s in stats}  # store None if missing

                wins = stats_map.get('wins')
                if wins is None:
                    self.logger.warning("'wins' stat missing or null in ESPN standings response")
                    wins = 0

                losses = stats_map.get('losses')
                if losses is None:
                    self.logger.warning("'losses' stat missing or null in ESPN standings response")
                    losses = 0
                games_played = wins + losses
                games_played_list.append(games_played)

            if not games_played_list:
                self.logger.warning("No valid games played data found in standings")
                return None

            average_pace = sum(games_played_list) / len(games_played_list)
            return round(average_pace, 1)

        except httpx.RequestError as e:
            self.logger.warning(f"Failed to fetch NBA standings: {type(e).__name__}: {e}")
            return None
        except (KeyError, ValueError, IndexError) as e:
            self.logger.warning(f"Failed to parse NBA standings response: {type(e).__name__}: {e}")
            return None
        except Exception as e:
            self.logger.warning(f"Unexpected error fetching NBA average pace: {type(e).__name__}: {e}")
            return None

    async def get_nba_game_days_remaining(self, season_id: int) -> Optional[int]:
        """
        Calculate remaining game days in NBA regular season, cached 30 min.

        Args:
            season_id: NBA season year (e.g., 2026 for "2025-26")

        Returns:
            Number of days with NBA games remaining until end of regular season, or None if fetch fails
        """
        cache = self._days_left_cache
        if (
            cache['season_id'] == season_id
            and cache['ts'] is not None
            and datetime.now() - cache['ts'] < _CACHE_TTL
        ):
            return cache['value']

        value = await self._fetch_nba_game_days_remaining(season_id)
        self._days_left_cache = {'season_id': season_id, 'value': value, 'ts': datetime.now()}
        return value

    async def get_regular_season_start_date(self, season_id: int):
        """The actual first regular-season game date for `season_id` (skips
        preseason), derived from ESPN's whitelist calendar — not cached here,
        meant to be called once at app startup and stored on settings."""
        try:
            dates, start_idx, _ = await self._get_regular_season_calendar(season_id)
            return dates[start_idx]
        except Exception as e:
            self.logger.warning(f"Failed to derive regular season start for {season_id}: {type(e).__name__}: {e}")
            return None

    async def _get_event_season_type(self, day) -> Optional[int]:
        """season.type for the first event on `day` (1=preseason, 2=regular, 3+=postseason/play-in),
        or None if the fetch fails / no events that day."""
        try:
            url = f"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates={day.strftime('%Y%m%d')}"
            response = await self._client.get(url)
            response.raise_for_status()
            events = response.json().get('events', [])
            return events[0].get('season', {}).get('type') if events else None
        except Exception as e:
            self.logger.warning(f"Failed to fetch season type for {day}: {type(e).__name__}: {e}")
            return None

    async def _binary_search_first(self, calendar_dates: list, min_type: int) -> Optional[int]:
        """Leftmost index in sorted `calendar_dates` whose season.type >= min_type,
        or None if no probed date qualifies."""
        lo, hi = 0, len(calendar_dates) - 1
        result = None
        while lo <= hi:
            mid = (lo + hi) // 2
            season_type = await self._get_event_season_type(calendar_dates[mid])
            if season_type is not None and season_type >= min_type:
                result = mid
                hi = mid - 1
            else:
                lo = mid + 1
        return result

    async def _get_regular_season_calendar(self, season_id: int) -> tuple[list, int, int]:
        """(all_game_dates, start_idx, end_idx) bounding the regular season for
        `season_id` (ESPN convention: season_id = year the season ends, e.g.
        2026 for "2025-26"). Anchors the calendar query to a date safely inside
        that season instead of ESPN's default (which reflects whichever season
        is nearest to *today*, not necessarily the one this app is configured
        for) — an already-completed or future SEASON_ID would otherwise derive
        the wrong season's boundaries entirely. An anchored/historical calendar
        also includes playoffs, so both ends are probed rather than just the
        start."""
        anchor = datetime(season_id - 1, 11, 1).strftime('%Y%m%d')
        url = f"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?calendartype=whitelist&dates={anchor}"
        response = await self._client.get(url)
        response.raise_for_status()
        data = response.json()

        calendar = data.get('leagues', [{}])[0].get('calendar', [])
        if not calendar:
            raise ValueError("No calendar data found in NBA scoreboard response")

        all_game_dates = [datetime.fromisoformat(d.replace('Z', '+00:00')).date() for d in calendar]

        start_idx = await self._binary_search_first(all_game_dates, min_type=2)
        if start_idx is None:
            self.logger.warning(f"Could not determine regular-season start for {season_id}; not filtering preseason")
            start_idx = 0

        postseason_idx = await self._binary_search_first(all_game_dates, min_type=3)
        end_idx = (postseason_idx - 1) if postseason_idx is not None else len(all_game_dates) - 1

        return all_game_dates, start_idx, end_idx

    async def _fetch_nba_game_days_remaining(self, season_id: int) -> Optional[int]:
        try:
            all_game_dates, start_idx, end_idx = await self._get_regular_season_calendar(season_id)
            today = datetime.now().date()
            regular_season_dates = all_game_dates[start_idx:end_idx + 1]
            future_game_dates = [d for d in regular_season_dates if d >= today]
            return len(future_game_dates)
        except httpx.RequestError as e:
            self.logger.warning(f"Failed to fetch NBA calendar: {type(e).__name__}: {e}")
            return None
        except (KeyError, ValueError, IndexError) as e:
            self.logger.warning(f"Failed to parse NBA calendar response: {type(e).__name__}: {e}")
            return None
        except Exception as e:
            self.logger.warning(f"Unexpected error fetching NBA game days remaining: {type(e).__name__}: {e}")
            return None

    async def close(self):
        """Close the HTTP client connection pool"""
        if hasattr(self, '_client'):
            await self._client.aclose()

import httpx
from typing import Optional
from datetime import datetime
import logging

class NBAStatsService:
    """Service for fetching NBA league-wide statistics from ESPN APIs"""

    def __init__(self):
        self.logger = logging.getLogger(__name__)
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(30.0, connect=10.0),
            limits=httpx.Limits(max_keepalive_connections=10, max_connections=20)
        )

    async def get_nba_average_pace(self, season_id: int) -> Optional[float]:
        """
        Get average games played per NBA team from standings

        Args:
            season_id: NBA season year (e.g., 2026)

        Returns:
            Average games played across all 30 NBA teams, or None if fetch fails
        """
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
                if len(stats) < 15:
                    continue

                wins = stats[14].get('value', 0)
                losses = stats[6].get('value', 0)
                games_played = wins + losses
                games_played_list.append(games_played)

            if not games_played_list:
                self.logger.warning("No valid games played data found in standings")
                return None

            average_pace = sum(games_played_list) / len(games_played_list)
            return round(average_pace, 1)

        except httpx.RequestError as e:
            self.logger.warning(f"Failed to fetch NBA standings: {e}")
            return None
        except (KeyError, ValueError, IndexError) as e:
            self.logger.warning(f"Failed to parse NBA standings response: {e}")
            return None
        except Exception as e:
            self.logger.warning(f"Unexpected error fetching NBA average pace: {e}")
            return None

    async def get_nba_game_days_remaining(self) -> Optional[int]:
        """
        Calculate remaining game days in NBA regular season

        Returns:
            Number of days with NBA games remaining until end of regular season, or None if fetch fails
        """
        try:
            url = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?calendartype=whitelist"
            response = await self._client.get(url)
            response.raise_for_status()
            data = response.json()

            calendar = data.get('leagues', [{}])[0].get('calendar', [])
            if not calendar:
                self.logger.warning("No calendar data found in NBA scoreboard response")
                return None

            today = datetime.now().date()
            regular_season_end = datetime.fromisoformat('2026-04-12T23:59:59+00:00').date()

            future_game_dates = [
                datetime.fromisoformat(date.replace('Z', '+00:00')).date()
                for date in calendar
                if datetime.fromisoformat(date.replace('Z', '+00:00')).date() > today
                and datetime.fromisoformat(date.replace('Z', '+00:00')).date() <= regular_season_end
            ]

            return len(future_game_dates)

        except httpx.RequestError as e:
            self.logger.warning(f"Failed to fetch NBA calendar: {e}")
            return None
        except (KeyError, ValueError, IndexError) as e:
            self.logger.warning(f"Failed to parse NBA calendar response: {e}")
            return None
        except Exception as e:
            self.logger.warning(f"Unexpected error fetching NBA game days remaining: {e}")
            return None

    async def close(self):
        """Close the HTTP client connection pool"""
        if hasattr(self, '_client'):
            await self._client.aclose()

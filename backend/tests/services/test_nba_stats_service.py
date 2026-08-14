import pytest
import httpx
from unittest.mock import Mock, patch, AsyncMock
from datetime import datetime, date
from app.services.nba_stats_service import NBAStatsService


@pytest.fixture
def nba_stats_service():
    """Create NBAStatsService instance"""
    return NBAStatsService()


@pytest.fixture
def mock_standings_response():
    """Mock successful NBA standings response"""
    return {
        'children': [
            {
                'standings': {
                    'entries': [
                        {
                            'team': {'displayName': 'Team A'},
                            'stats': [
                                {'name': 'stat0', 'value': 0},
                                {'name': 'stat1', 'value': 1},
                                {'name': 'stat2', 'value': 2},
                                {'name': 'stat3', 'value': 3},
                                {'name': 'stat4', 'value': 4},
                                {'name': 'stat5', 'value': 5},
                                {'name': 'losses', 'value': 20},
                                {'name': 'stat7', 'value': 7},
                                {'name': 'stat8', 'value': 8},
                                {'name': 'stat9', 'value': 9},
                                {'name': 'stat10', 'value': 10},
                                {'name': 'stat11', 'value': 11},
                                {'name': 'stat12', 'value': 12},
                                {'name': 'stat13', 'value': 13},
                                {'name': 'wins', 'value': 40}
                            ]
                        },
                        {
                            'team': {'displayName': 'Team B'},
                            'stats': [
                                {'name': 'stat0', 'value': 0},
                                {'name': 'stat1', 'value': 1},
                                {'name': 'stat2', 'value': 2},
                                {'name': 'stat3', 'value': 3},
                                {'name': 'stat4', 'value': 4},
                                {'name': 'stat5', 'value': 5},
                                {'name': 'losses', 'value': 25},
                                {'name': 'stat7', 'value': 7},
                                {'name': 'stat8', 'value': 8},
                                {'name': 'stat9', 'value': 9},
                                {'name': 'stat10', 'value': 10},
                                {'name': 'stat11', 'value': 11},
                                {'name': 'stat12', 'value': 12},
                                {'name': 'stat13', 'value': 13},
                                {'name': 'wins', 'value': 35}
                            ]
                        }
                    ]
                }
            },
            {
                'standings': {
                    'entries': [
                        {
                            'team': {'displayName': 'Team C'},
                            'stats': [
                                {'name': 'stat0', 'value': 0},
                                {'name': 'stat1', 'value': 1},
                                {'name': 'stat2', 'value': 2},
                                {'name': 'stat3', 'value': 3},
                                {'name': 'stat4', 'value': 4},
                                {'name': 'stat5', 'value': 5},
                                {'name': 'losses', 'value': 30},
                                {'name': 'stat7', 'value': 7},
                                {'name': 'stat8', 'value': 8},
                                {'name': 'stat9', 'value': 9},
                                {'name': 'stat10', 'value': 10},
                                {'name': 'stat11', 'value': 11},
                                {'name': 'stat12', 'value': 12},
                                {'name': 'stat13', 'value': 13},
                                {'name': 'wins', 'value': 30}
                            ]
                        }
                    ]
                }
            }
        ]
    }


@pytest.fixture
def mock_calendar_response():
    """Mock successful NBA calendar response"""
    future_dates = [
        '2026-03-01T00:00:00Z',
        '2026-03-03T00:00:00Z',
        '2026-03-05T00:00:00Z',
        '2026-03-08T00:00:00Z',
        '2026-03-10T00:00:00Z',
        '2026-04-05T00:00:00Z',
        '2026-04-10T00:00:00Z'
    ]
    return {
        'leagues': [
            {
                'calendar': future_dates
            }
        ]
    }


class TestNBAStatsServiceAveragePace:
    """Test suite for get_nba_average_pace method"""

    @pytest.mark.asyncio
    async def test_get_nba_average_pace_success(self, nba_stats_service, mock_standings_response):
        """Test successful average pace calculation"""
        mock_response = Mock()
        mock_response.json.return_value = mock_standings_response
        mock_response.raise_for_status = Mock()

        with patch.object(nba_stats_service._client, 'get', new_callable=AsyncMock, return_value=mock_response):
            result = await nba_stats_service.get_nba_average_pace(2026)

            assert result is not None
            assert isinstance(result, float)
            expected_avg = (60 + 60 + 60) / 3
            assert result == round(expected_avg, 1)

    @pytest.mark.asyncio
    async def test_get_nba_average_pace_http_error(self, nba_stats_service):
        """Test handling of HTTP request error"""
        with patch.object(nba_stats_service._client, 'get', side_effect=httpx.RequestError("Connection failed")):
            result = await nba_stats_service.get_nba_average_pace(2026)

            assert result is None

    @pytest.mark.asyncio
    async def test_get_nba_average_pace_http_status_error(self, nba_stats_service):
        """Test handling of HTTP status error"""
        mock_response = Mock()
        mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
            "404 Not Found",
            request=Mock(),
            response=Mock()
        )

        with patch.object(nba_stats_service._client, 'get', new_callable=AsyncMock, return_value=mock_response):
            result = await nba_stats_service.get_nba_average_pace(2026)

            assert result is None

    @pytest.mark.asyncio
    async def test_get_nba_average_pace_empty_response(self, nba_stats_service):
        """Test handling of empty standings data"""
        mock_response = Mock()
        mock_response.json.return_value = {'children': []}
        mock_response.raise_for_status = Mock()

        with patch.object(nba_stats_service._client, 'get', new_callable=AsyncMock, return_value=mock_response):
            result = await nba_stats_service.get_nba_average_pace(2026)

            assert result is None

    @pytest.mark.asyncio
    async def test_get_nba_average_pace_missing_children(self, nba_stats_service):
        """Test handling of missing children key"""
        mock_response = Mock()
        mock_response.json.return_value = {}
        mock_response.raise_for_status = Mock()

        with patch.object(nba_stats_service._client, 'get', new_callable=AsyncMock, return_value=mock_response):
            result = await nba_stats_service.get_nba_average_pace(2026)

            assert result is None

    @pytest.mark.asyncio
    async def test_get_nba_average_pace_insufficient_stats(self, nba_stats_service):
        """Test handling of entries with insufficient stats"""
        mock_response = Mock()
        mock_response.json.return_value = {
            'children': [
                {
                    'standings': {
                        'entries': [
                            {
                                'team': {'displayName': 'Team A'},
                                'stats': [{'value': 1}, {'value': 2}]
                            }
                        ]
                    }
                }
            ]
        }
        mock_response.raise_for_status = Mock()

        with patch.object(nba_stats_service._client, 'get', new_callable=AsyncMock, return_value=mock_response):
            result = await nba_stats_service.get_nba_average_pace(2026)

            assert result is None

    @pytest.mark.asyncio
    async def test_get_nba_average_pace_parse_error(self, nba_stats_service):
        """Test handling of JSON parse error"""
        mock_response = Mock()
        mock_response.json.side_effect = ValueError("Invalid JSON")
        mock_response.raise_for_status = Mock()

        with patch.object(nba_stats_service._client, 'get', new_callable=AsyncMock, return_value=mock_response):
            result = await nba_stats_service.get_nba_average_pace(2026)

            assert result is None


class TestNBAStatsServiceGameDaysRemaining:
    """Test suite for get_nba_game_days_remaining method"""

    @pytest.mark.asyncio
    async def test_get_nba_game_days_remaining_success(self, nba_stats_service, mock_calendar_response):
        """Test successful game days remaining calculation"""
        mock_response = Mock()
        mock_response.json.return_value = mock_calendar_response
        mock_response.raise_for_status = Mock()

        with patch.object(nba_stats_service._client, 'get', new_callable=AsyncMock, return_value=mock_response):
            with patch('app.services.nba_stats_service.datetime') as mock_datetime:
                mock_datetime.now.return_value.date.return_value = datetime(2026, 2, 28).date()
                mock_datetime.fromisoformat = datetime.fromisoformat

                result = await nba_stats_service.get_nba_game_days_remaining(2026)

                assert result is not None
                assert isinstance(result, int)
                assert result == 7

    @pytest.mark.asyncio
    async def test_get_nba_game_days_remaining_filters_past_dates(self, nba_stats_service):
        """Test that past dates are filtered out"""
        mock_response = Mock()
        mock_response.json.return_value = {
            'leagues': [
                {
                    'calendar': [
                        '2026-02-01T00:00:00Z',
                        '2026-03-01T00:00:00Z',
                        '2026-04-01T00:00:00Z'
                    ]
                }
            ]
        }
        mock_response.raise_for_status = Mock()

        with patch.object(nba_stats_service._client, 'get', new_callable=AsyncMock, return_value=mock_response):
            with patch('app.services.nba_stats_service.datetime') as mock_datetime:
                mock_datetime.now.return_value.date.return_value = datetime(2026, 2, 15).date()
                mock_datetime.fromisoformat = datetime.fromisoformat

                result = await nba_stats_service.get_nba_game_days_remaining(2026)

                assert result == 2

    @pytest.mark.asyncio
    async def test_get_nba_game_days_remaining_filters_post_season(self, nba_stats_service):
        """Dates at/after the detected postseason boundary are excluded, even
        though they're still in the future relative to `today`."""
        nba_stats_service._get_regular_season_calendar = AsyncMock(
            return_value=(
                [date(2026, 4, 1), date(2026, 4, 15), date(2026, 5, 1)],
                0,  # start_idx: whole window is regular season or later
                0,  # end_idx: only index 0 (04-01) is still regular season
            )
        )
        with patch('app.services.nba_stats_service.datetime') as mock_datetime:
            mock_datetime.now.return_value.date.return_value = datetime(2026, 3, 1).date()

            result = await nba_stats_service.get_nba_game_days_remaining(2026)

            assert result == 1

    @pytest.mark.asyncio
    async def test_get_nba_game_days_remaining_uses_resolved_window(self, nba_stats_service):
        """Only dates within [start_idx, end_idx] of the resolved calendar count,
        regardless of how many extra dates the raw ESPN calendar contains."""
        nba_stats_service._get_regular_season_calendar = AsyncMock(
            return_value=(
                [date(2026, 1, 1), date(2026, 2, 1), date(2026, 3, 1), date(2026, 4, 1), date(2026, 6, 1)],
                1,  # start_idx: preseason date at index 0 excluded
                3,  # end_idx: postseason date at index 4 excluded
            )
        )
        with patch('app.services.nba_stats_service.datetime') as mock_datetime:
            mock_datetime.now.return_value.date.return_value = datetime(2026, 1, 15).date()

            result = await nba_stats_service.get_nba_game_days_remaining(2026)

            # window is [02-01, 03-01, 04-01]; all >= 2026-01-15
            assert result == 3

    @pytest.mark.asyncio
    async def test_get_nba_game_days_remaining_http_error(self, nba_stats_service):
        """Test handling of HTTP request error"""
        with patch.object(nba_stats_service._client, 'get', side_effect=httpx.RequestError("Connection failed")):
            result = await nba_stats_service.get_nba_game_days_remaining(2026)

            assert result is None

    @pytest.mark.asyncio
    async def test_get_nba_game_days_remaining_empty_calendar(self, nba_stats_service):
        """Test handling of empty calendar data"""
        mock_response = Mock()
        mock_response.json.return_value = {'leagues': [{'calendar': []}]}
        mock_response.raise_for_status = Mock()

        with patch.object(nba_stats_service._client, 'get', new_callable=AsyncMock, return_value=mock_response):
            result = await nba_stats_service.get_nba_game_days_remaining(2026)

            assert result is None

    @pytest.mark.asyncio
    async def test_get_nba_game_days_remaining_missing_leagues(self, nba_stats_service):
        """Test handling of missing leagues key"""
        mock_response = Mock()
        mock_response.json.return_value = {}
        mock_response.raise_for_status = Mock()

        with patch.object(nba_stats_service._client, 'get', new_callable=AsyncMock, return_value=mock_response):
            result = await nba_stats_service.get_nba_game_days_remaining(2026)

            assert result is None

    @pytest.mark.asyncio
    async def test_get_nba_game_days_remaining_parse_error(self, nba_stats_service):
        """Test handling of date parse error"""
        mock_response = Mock()
        mock_response.json.return_value = {
            'leagues': [
                {
                    'calendar': ['invalid-date-format']
                }
            ]
        }
        mock_response.raise_for_status = Mock()

        with patch.object(nba_stats_service._client, 'get', new_callable=AsyncMock, return_value=mock_response):
            result = await nba_stats_service.get_nba_game_days_remaining(2026)

            assert result is None


def _routed_client_mock(calendar_dates, season_types):
    """Fake httpx client 'get' that returns the whitelist calendar for the
    calendar-lookup URL, and a per-day season-type event payload for the
    single-day scoreboard probe URLs used by the start/end binary search.
    `season_types` maps 'YYYYMMDD' -> ESPN season.type (1=pre, 2=regular, 3+=post)."""
    import re

    async def _get(url, *args, **kwargs):
        resp = Mock()
        resp.raise_for_status = Mock()
        if 'calendartype=whitelist' in url:
            resp.json.return_value = {'leagues': [{'calendar': calendar_dates}]}
        else:
            m = re.search(r'dates=(\d{8})', url)
            season_type = season_types.get(m.group(1)) if m else None
            events = [{'season': {'type': season_type}}] if season_type is not None else []
            resp.json.return_value = {'events': events}
        return resp

    return AsyncMock(side_effect=_get)


class TestNBAStatsServiceRegularSeasonCalendar:
    """Test suite for _get_regular_season_calendar / _binary_search_first /
    get_regular_season_start_date — the ESPN-calendar-derived season window
    that replaced the old hand-maintained SEASON_START/SEASON_END dates."""

    @pytest.mark.asyncio
    async def test_get_regular_season_calendar_finds_start_and_end(self, nba_stats_service):
        calendar_dates = [
            '2025-10-15T00:00:00Z',  # preseason
            '2025-10-22T00:00:00Z',  # regular season start
            '2026-03-01T00:00:00Z',  # regular season
            '2026-04-15T00:00:00Z',  # postseason start
        ]
        season_types = {
            '20251015': 1,
            '20251022': 2,
            '20260301': 2,
            '20260415': 3,
        }
        with patch.object(nba_stats_service._client, 'get', _routed_client_mock(calendar_dates, season_types)):
            dates, start_idx, end_idx = await nba_stats_service._get_regular_season_calendar(2026)

        assert dates[start_idx] == date(2025, 10, 22)
        assert dates[end_idx] == date(2026, 3, 1)

    @pytest.mark.asyncio
    async def test_get_regular_season_calendar_no_postseason_probed_keeps_last_date(self, nba_stats_service):
        """When every probed date resolves to regular season (no postseason
        detected), the window runs through the end of the raw calendar."""
        calendar_dates = ['2025-10-22T00:00:00Z', '2026-03-01T00:00:00Z']
        season_types = {'20251022': 2, '20260301': 2}
        with patch.object(nba_stats_service._client, 'get', _routed_client_mock(calendar_dates, season_types)):
            dates, start_idx, end_idx = await nba_stats_service._get_regular_season_calendar(2026)

        assert start_idx == 0
        assert end_idx == len(dates) - 1

    @pytest.mark.asyncio
    async def test_get_regular_season_calendar_empty_calendar_raises(self, nba_stats_service):
        with patch.object(nba_stats_service._client, 'get', _routed_client_mock([], {})):
            with pytest.raises(ValueError, match="No calendar data"):
                await nba_stats_service._get_regular_season_calendar(2026)

    @pytest.mark.asyncio
    async def test_get_regular_season_start_date_returns_first_regular_season_day(self, nba_stats_service):
        calendar_dates = ['2025-10-15T00:00:00Z', '2025-10-22T00:00:00Z']
        season_types = {'20251015': 1, '20251022': 2}
        with patch.object(nba_stats_service._client, 'get', _routed_client_mock(calendar_dates, season_types)):
            start = await nba_stats_service.get_regular_season_start_date(2026)

        assert start == date(2025, 10, 22)

    @pytest.mark.asyncio
    async def test_get_regular_season_start_date_returns_none_on_failure(self, nba_stats_service):
        with patch.object(nba_stats_service._client, 'get', side_effect=httpx.RequestError("boom")):
            start = await nba_stats_service.get_regular_season_start_date(2026)

        assert start is None


class TestNBAStatsServiceClose:
    """Test suite for close method"""

    @pytest.mark.asyncio
    async def test_close_success(self, nba_stats_service):
        """Test successful client close"""
        mock_client = AsyncMock()
        nba_stats_service._client = mock_client

        await nba_stats_service.close()

        mock_client.aclose.assert_called_once()

    @pytest.mark.asyncio
    async def test_close_no_client(self):
        """Test close when client doesn't exist"""
        service = NBAStatsService()
        delattr(service, '_client')

        await service.close()

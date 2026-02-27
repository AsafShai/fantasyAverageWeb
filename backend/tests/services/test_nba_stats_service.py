import pytest
import httpx
from unittest.mock import Mock, patch, AsyncMock
from datetime import datetime
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

                result = await nba_stats_service.get_nba_game_days_remaining()

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

                result = await nba_stats_service.get_nba_game_days_remaining()

                assert result == 2

    @pytest.mark.asyncio
    async def test_get_nba_game_days_remaining_filters_post_season(self, nba_stats_service):
        """Test that dates after regular season end are filtered out"""
        mock_response = Mock()
        mock_response.json.return_value = {
            'leagues': [
                {
                    'calendar': [
                        '2026-04-01T00:00:00Z',
                        '2026-04-15T00:00:00Z',
                        '2026-05-01T00:00:00Z'
                    ]
                }
            ]
        }
        mock_response.raise_for_status = Mock()

        with patch.object(nba_stats_service._client, 'get', new_callable=AsyncMock, return_value=mock_response):
            with patch('app.services.nba_stats_service.datetime') as mock_datetime:
                mock_datetime.now.return_value.date.return_value = datetime(2026, 3, 1).date()
                mock_datetime.fromisoformat = datetime.fromisoformat

                result = await nba_stats_service.get_nba_game_days_remaining()

                assert result == 1

    @pytest.mark.asyncio
    async def test_get_nba_game_days_remaining_http_error(self, nba_stats_service):
        """Test handling of HTTP request error"""
        with patch.object(nba_stats_service._client, 'get', side_effect=httpx.RequestError("Connection failed")):
            result = await nba_stats_service.get_nba_game_days_remaining()

            assert result is None

    @pytest.mark.asyncio
    async def test_get_nba_game_days_remaining_empty_calendar(self, nba_stats_service):
        """Test handling of empty calendar data"""
        mock_response = Mock()
        mock_response.json.return_value = {'leagues': [{'calendar': []}]}
        mock_response.raise_for_status = Mock()

        with patch.object(nba_stats_service._client, 'get', new_callable=AsyncMock, return_value=mock_response):
            result = await nba_stats_service.get_nba_game_days_remaining()

            assert result is None

    @pytest.mark.asyncio
    async def test_get_nba_game_days_remaining_missing_leagues(self, nba_stats_service):
        """Test handling of missing leagues key"""
        mock_response = Mock()
        mock_response.json.return_value = {}
        mock_response.raise_for_status = Mock()

        with patch.object(nba_stats_service._client, 'get', new_callable=AsyncMock, return_value=mock_response):
            result = await nba_stats_service.get_nba_game_days_remaining()

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
            result = await nba_stats_service.get_nba_game_days_remaining()

            assert result is None


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

import pytest
import pytest_asyncio
import pandas as pd
from unittest.mock import AsyncMock, Mock, patch
from app.services.trades_service import TradesService
from app.models import TradeSuggestionsResponse, TradeSuggestion, TradeSuggestionAIResponse, TradeSuggestionAI, Team, Player, PlayerStats
from app.exceptions import ResourceNotFoundError, DataSourceError

class TestTradesService:
    """Test suite for TradesService - key functionality only"""

    @pytest.fixture
    def trades_service(self):
        """Create TradesService with mocked dependencies"""
        mock_data_provider = AsyncMock()
        mock_ai_service = Mock()
        
        # Create service with mocked dependencies
        service = TradesService(data_provider=mock_data_provider, ai_service=mock_ai_service)
        return service

    @pytest.fixture
    def sample_dataframes(self):
        """Sample DataFrames for testing"""
        players_df = pd.DataFrame({
            'team_id': [1, 1, 2, 2],
            'Name': ['Player A', 'Player B', 'Player C', 'Player D'],
            'Pro Team': ['LAL', 'LAL', 'GSW', 'GSW'],
            'Positions': ['PG', 'SF', 'SG', 'PF'],
            'PTS': [25.0, 20.0, 22.0, 18.0],
            'REB': [8.0, 6.0, 7.0, 9.0],
            'AST': [7.0, 4.0, 5.0, 3.0],
            'GP': [75, 70, 72, 68]
        })
        
        totals_df = pd.DataFrame({
            'team_id': [1, 2], 'team_name': ['Team A', 'Team B'],
            'PTS': [8500, 8200], 'REB': [3200, 3400], 'GP': [82, 82]
        })
        
        averages_df = pd.DataFrame({
            'team_id': [1, 2], 'team_name': ['Team A', 'Team B'],
            'PTS': [103.7, 100.0], 'REB': [39.0, 41.5], 'GP': [82, 82]
        })
        
        rankings_df = pd.DataFrame({
            'team_id': [1, 2], 'team_name': ['Team A', 'Team B'],
            'RANK': [1, 2], 'TOTAL_POINTS': [15, 12]
        })
        
        return players_df, totals_df, averages_df, rankings_df

    @pytest.mark.asyncio
    async def test_get_trades_suggestions_success(self, trades_service, sample_dataframes):
        """Test successful trade suggestions generation"""
        team_id = 1
        players_df, totals_df, averages_df, rankings_df = sample_dataframes
        
        # Mock data provider responses
        trades_service.data_provider.get_all_dataframes.return_value = (totals_df, averages_df, rankings_df)
        trades_service.data_provider.get_players_df.return_value = players_df
        
        # Mock AI service response
        ai_response = TradeSuggestionAIResponse(
            trade_suggestions=[
                TradeSuggestionAI(
                    opponent_team='Team A',
                    players_to_give=['Player A'],
                    players_to_receive=['Player C'],
                    reasoning='Better shooting'
                )
            ]
        )
        trades_service.ai_service.get_trade_suggestions.return_value = ai_response
        
        # Mock the _get_trade_suggestions method to return a simple list
        with patch.object(trades_service, '_get_trade_suggestions') as mock_get_suggestions:
            mock_get_suggestions.return_value = []
            
            result = await trades_service.get_trades_suggestions_by_team_id(team_id)
            
            assert isinstance(result, TradeSuggestionsResponse)
            trades_service.ai_service.get_trade_suggestions.assert_called_once()

    @pytest.mark.asyncio 
    async def test_get_trades_suggestions_no_players_data(self, trades_service, sample_dataframes):
        """Test when no players data is available"""
        team_id = 1
        _, totals_df, averages_df, rankings_df = sample_dataframes
        
        trades_service.data_provider.get_all_dataframes.return_value = (totals_df, averages_df, rankings_df)
        trades_service.data_provider.get_players_df.return_value = None
        
        with pytest.raises(DataSourceError, match="Unable to process players data from ESPN API"):
            await trades_service.get_trades_suggestions_by_team_id(team_id)

    @pytest.mark.asyncio
    async def test_get_trades_suggestions_ai_service_error(self, trades_service, sample_dataframes):
        """Test when AI service fails"""
        team_id = 1
        players_df, totals_df, averages_df, rankings_df = sample_dataframes
        
        trades_service.data_provider.get_players_df.return_value = players_df
        trades_service.data_provider.get_totals_df.return_value = totals_df
        trades_service.data_provider.get_averages_df.return_value = averages_df
        trades_service.data_provider.get_rankings_df.return_value = rankings_df
        
        # Mock AI service failure
        trades_service.ai_service.get_trade_suggestions.side_effect = Exception("AI API failed")
        
        with pytest.raises(DataSourceError, match="Unable to get trade suggestions"):
            await trades_service.get_trades_suggestions_by_team_id(team_id)

    @pytest.mark.asyncio
    async def test_get_trades_suggestions_empty_players(self, trades_service):
        """Test when players DataFrame is empty"""
        team_id = 1
        empty_players_df = pd.DataFrame()
        
        trades_service.data_provider.get_players_df.return_value = empty_players_df
        
        with pytest.raises(DataSourceError, match="Unable to get trade suggestions"):
            await trades_service.get_trades_suggestions_by_team_id(team_id)
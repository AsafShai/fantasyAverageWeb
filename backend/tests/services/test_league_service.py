import pytest
import pytest_asyncio
import pandas as pd
from unittest.mock import Mock, patch, AsyncMock
from app.services.league_service import LeagueService
from app.models import LeagueSummary, HeatmapData, LeagueShotsData, AverageStats, RankingStats
from app.exceptions import ResourceNotFoundError


@pytest.fixture
def league_service():
    """Create LeagueService instance with mocked dependencies"""
    with patch('app.services.league_service.DataProvider') as mock_data_provider, \
         patch('app.services.league_service.StatsCalculator') as mock_stats_calculator, \
         patch('app.services.league_service.ResponseBuilder') as mock_response_builder:
        service = LeagueService()
        service.data_provider = AsyncMock()
        service.stats_calculator = mock_stats_calculator.return_value
        service.response_builder = mock_response_builder.return_value
        return service






class TestLeagueService:
    """Test suite for LeagueService class"""
    
    @pytest.mark.asyncio
    async def test_get_league_summary_success(self, league_service, sample_averages_df):
        """Test successful league summary retrieval"""
        expected_summary = Mock(spec=LeagueSummary)
        mock_category_leaders = {'PTS': Mock(spec=RankingStats)}
        mock_league_averages = Mock(spec=AverageStats)
        
        league_service.data_provider.get_averages_df.return_value = sample_averages_df
        league_service.stats_calculator.find_category_leaders.return_value = {
            'PTS': {'team_id': 1}
        }
        league_service.stats_calculator.calculate_league_averages.return_value = {}
        league_service.response_builder.create_ranking_stats_from_averages.return_value = mock_category_leaders['PTS']
        league_service.response_builder.create_average_stats.return_value = mock_league_averages
        league_service.response_builder.build_league_summary_response.return_value = expected_summary
        
        result = await league_service.get_league_summary()
        
        assert result == expected_summary
        league_service.data_provider.get_averages_df.assert_called_once()
        league_service.response_builder.build_league_summary_response.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_get_league_summary_data_provider_returns_none(self, league_service):
        """Test get_league_summary when data provider returns None"""
        league_service.data_provider.get_averages_df.return_value = None
        
        with pytest.raises(ResourceNotFoundError, match="Unable to fetch averages data from ESPN API"):
            await league_service.get_league_summary()
    
    @pytest.mark.asyncio
    async def test_get_heatmap_data_success(self, league_service, sample_averages_df):
        """Test successful heatmap data retrieval"""
        expected_heatmap = Mock(spec=HeatmapData)
        mock_normalized_data = [[1.0, 2.0], [3.0, 4.0]]
        
        league_service.data_provider.get_averages_df.return_value = sample_averages_df
        league_service.stats_calculator.normalize_for_heatmap.return_value = mock_normalized_data
        league_service.response_builder.build_heatmap_response.return_value = expected_heatmap
        
        result = await league_service.get_heatmap_data()
        
        assert result == expected_heatmap
        league_service.data_provider.get_averages_df.assert_called_once()
        league_service.stats_calculator.normalize_for_heatmap.assert_called_once_with(sample_averages_df)
        league_service.response_builder.build_heatmap_response.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_get_heatmap_data_data_provider_returns_none(self, league_service):
        """Test get_heatmap_data when data provider returns None"""
        league_service.data_provider.get_averages_df.return_value = None
        
        with pytest.raises(ResourceNotFoundError, match="Unable to fetch averages data from ESPN API"):
            await league_service.get_heatmap_data()
    
    @pytest.mark.asyncio
    async def test_get_league_shots_data_success(self, league_service, sample_totals_df):
        """Test successful league shots data retrieval"""
        expected_shots_data = Mock(spec=LeagueShotsData)
        
        league_service.data_provider.get_totals_df.return_value = sample_totals_df
        league_service.response_builder.build_league_shots_response.return_value = expected_shots_data
        
        result = await league_service.get_league_shots_data()
        
        assert result == expected_shots_data
        league_service.data_provider.get_totals_df.assert_called_once()
        league_service.response_builder.build_league_shots_response.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_get_league_shots_data_data_provider_returns_none(self, league_service):
        """Test get_league_shots_data when data provider returns None"""
        league_service.data_provider.get_totals_df.return_value = None
        
        with pytest.raises(ResourceNotFoundError, match="Unable to fetch totals data from ESPN API"):
            await league_service.get_league_shots_data()


class TestLeagueServiceResponseBuilding:
    """Response building tests for LeagueService with mocked dependencies but real ResponseBuilder"""
    
    @pytest.fixture
    def response_building_league_service(self, sample_averages_df, sample_totals_df):
        """Create LeagueService with mocked DataProvider and StatsCalculator but real ResponseBuilder"""
        with patch('app.services.league_service.DataProvider') as mock_data_provider, \
             patch('app.services.league_service.StatsCalculator') as mock_stats_calculator:
            service = LeagueService()
            service.data_provider = AsyncMock()
            service.stats_calculator = mock_stats_calculator.return_value
            
            # Mock data provider
            service.data_provider.get_averages_df.return_value = sample_averages_df
            service.data_provider.get_totals_df.return_value = sample_totals_df
            
            # Mock stats calculator with realistic results
            service.stats_calculator.find_category_leaders.return_value = {
                'PTS': {'team_id': 2} 
            }
            service.stats_calculator.calculate_league_averages.return_value = {
                'FG%': 45.5,
                'FT%': 75.6,
                '3PM': 15.2,
                'AST': 28.7,
                'REB': 43.4,
                'STL': 9.2,
                'BLK': 5.8,
                'PTS': 115.3,
                'GP': 82
            }
            service.stats_calculator.normalize_for_heatmap.return_value = [
                [0.8, 0.6], [1.0, 0.9], [0.5, 0.4]
            ]
            
            return service
    
    @pytest.mark.asyncio
    async def test_get_league_summary_response_building(self, response_building_league_service):
        """Response building test: Verify real LeagueSummary response building"""
        league_summary = await response_building_league_service.get_league_summary()
        
        assert isinstance(league_summary, LeagueSummary), "Should return LeagueSummary object"
        assert league_summary.total_teams == 3, "Should have 3 teams"
        assert league_summary.total_games_played == 246, "Should sum all GP (82*3)"
    
    @pytest.mark.asyncio
    async def test_get_heatmap_data_response_building(self, response_building_league_service):
        """Response building test: Verify real HeatmapData response building"""
        heatmap_data = await response_building_league_service.get_heatmap_data()
        
        assert isinstance(heatmap_data, HeatmapData), "Should return HeatmapData object"
        assert len(heatmap_data.teams) == 3, "Should have 3 teams"
    
    @pytest.mark.asyncio
    async def test_get_league_shots_data_response_building(self, response_building_league_service):
        """Response building test: Verify real LeagueShotsData response building"""
        shots_data = await response_building_league_service.get_league_shots_data()
        
        assert isinstance(shots_data, LeagueShotsData), "Should return LeagueShotsData object"
        assert len(shots_data.shots) == 3, "Should have 3 team shot records"


class TestLeagueServiceIntegration:
    """True integration tests for LeagueService with real component interaction"""
    
    @pytest_asyncio.fixture
    async def integration_service(self):
        """Create LeagueService with real dependencies using global MockDataProvider"""
        from app.services.league_service import LeagueService
        service = LeagueService()
        yield service
    
    @pytest.mark.asyncio
    async def test_integration_league_summary_data_flow(self, integration_service):
        """Test complete data flow: DataProvider -> StatsCalculator -> ResponseBuilder"""
        league_summary = await integration_service.get_league_summary()
        
        assert isinstance(league_summary, LeagueSummary)
        assert league_summary.total_teams == 3
        assert league_summary.total_games_played == 246  # 3 teams * 82 games each
        
        assert hasattr(league_summary, 'category_leaders')
        assert hasattr(league_summary, 'league_averages')
        
        assert isinstance(league_summary.category_leaders, dict)
        if league_summary.category_leaders:
            for category, leader in league_summary.category_leaders.items():
                assert isinstance(leader, RankingStats)
                assert hasattr(leader, 'team')
                assert hasattr(leader, 'pts')
                assert hasattr(leader, 'ast')
                assert hasattr(leader, 'reb')
        
        if league_summary.league_averages:
            assert isinstance(league_summary.league_averages, AverageStats)
            assert hasattr(league_summary.league_averages, 'pts')
            assert league_summary.league_averages.pts > 0
    
    @pytest.mark.asyncio 
    async def test_integration_error_propagation(self, integration_service):
        """Test that errors propagate correctly through the service layers"""
        from unittest.mock import patch
        from app.exceptions import ResourceNotFoundError
        
        # Mock DataProvider to return None
        with patch.object(integration_service.data_provider, 'get_averages_df', return_value=None):
            with pytest.raises(ResourceNotFoundError, match="Unable to fetch averages data from ESPN API"):
                await integration_service.get_league_summary()
    
    @pytest.mark.asyncio
    async def test_integration_heatmap_data_transformation(self, integration_service):
        """Test that heatmap data flows correctly through the transformation pipeline"""
        heatmap_data = await integration_service.get_heatmap_data()
        
        assert isinstance(heatmap_data, HeatmapData)
        assert len(heatmap_data.teams) == 3
        assert hasattr(heatmap_data, 'normalized_data')
        
        assert isinstance(heatmap_data.normalized_data, list)
        assert len(heatmap_data.normalized_data) == 3
        
        # Normalized stats should be floats between 0 and 1 (from StatsCalculator.normalize_for_heatmap)
        for team_stats in heatmap_data.normalized_data:
            assert isinstance(team_stats, list)
            for stat_value in team_stats:
                assert isinstance(stat_value, (int, float))
                assert 0 <= stat_value <= 1
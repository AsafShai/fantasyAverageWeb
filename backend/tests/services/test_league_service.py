import pytest
import pandas as pd
from unittest.mock import Mock, patch
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
        service.data_provider = mock_data_provider.return_value
        service.stats_calculator = mock_stats_calculator.return_value
        service.response_builder = mock_response_builder.return_value
        return service


@pytest.fixture
def sample_averages_df():
    """Sample averages DataFrame for testing"""
    return pd.DataFrame({
        'team_id': [1, 2, 3],
        'team_name': ['Team Alpha', 'Team Beta', 'Team Gamma'],
        'FG%': [46.7, 44.4, 45.5],
        'FT%': [74.9, 76.3, 75.7],
        '3PM': [15.2, 16.7, 13.7],
        'AST': [28.6, 27.6, 30.0],
        'REB': [43.5, 41.7, 44.9],
        'STL': [9.2, 8.4, 10.0],
        'BLK': [5.6, 6.5, 5.2],
        'PTS': [115.3, 121.0, 109.5],
        'GP': [82, 82, 82]
    })


@pytest.fixture
def sample_totals_df():
    """Sample totals DataFrame for testing"""
    return pd.DataFrame({
        'team_id': [1, 2, 3],
        'team_name': ['Team Alpha', 'Team Beta', 'Team Gamma'],
        'FGM': [3842, 3756, 3699],
        'FGA': [8234, 8456, 8123],
        'FG%': [46.7, 44.4, 45.5],
        'FTM': [1523, 1645, 1456],
        'FTA': [2034, 2156, 1923],
        'FT%': [74.9, 76.3, 75.7],
        'GP': [82, 82, 82]
    })


class TestLeagueService:
    """Test suite for LeagueService class"""
    
    def test_get_league_summary_success(self, league_service, sample_averages_df):
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
        
        result = league_service.get_league_summary()
        
        assert result == expected_summary
        league_service.data_provider.get_averages_df.assert_called_once()
        league_service.response_builder.build_league_summary_response.assert_called_once()
    
    def test_get_league_summary_data_provider_returns_none(self, league_service):
        """Test get_league_summary when data provider returns None"""
        league_service.data_provider.get_averages_df.return_value = None
        
        with pytest.raises(ResourceNotFoundError, match="Unable to fetch averages data from ESPN API"):
            league_service.get_league_summary()
    
    def test_get_heatmap_data_success(self, league_service, sample_averages_df):
        """Test successful heatmap data retrieval"""
        expected_heatmap = Mock(spec=HeatmapData)
        mock_normalized_data = [[1.0, 2.0], [3.0, 4.0]]
        
        league_service.data_provider.get_averages_df.return_value = sample_averages_df
        league_service.stats_calculator.normalize_for_heatmap.return_value = mock_normalized_data
        league_service.response_builder.build_heatmap_response.return_value = expected_heatmap
        
        result = league_service.get_heatmap_data()
        
        assert result == expected_heatmap
        league_service.data_provider.get_averages_df.assert_called_once()
        league_service.stats_calculator.normalize_for_heatmap.assert_called_once_with(sample_averages_df)
        league_service.response_builder.build_heatmap_response.assert_called_once()
    
    def test_get_heatmap_data_data_provider_returns_none(self, league_service):
        """Test get_heatmap_data when data provider returns None"""
        league_service.data_provider.get_averages_df.return_value = None
        
        with pytest.raises(ResourceNotFoundError, match="Unable to fetch averages data from ESPN API"):
            league_service.get_heatmap_data()
    
    def test_get_league_shots_data_success(self, league_service, sample_totals_df):
        """Test successful league shots data retrieval"""
        expected_shots_data = Mock(spec=LeagueShotsData)
        
        league_service.data_provider.get_totals_df.return_value = sample_totals_df
        league_service.response_builder.build_league_shots_response.return_value = expected_shots_data
        
        result = league_service.get_league_shots_data()
        
        assert result == expected_shots_data
        league_service.data_provider.get_totals_df.assert_called_once()
        league_service.response_builder.build_league_shots_response.assert_called_once()
    
    def test_get_league_shots_data_data_provider_returns_none(self, league_service):
        """Test get_league_shots_data when data provider returns None"""
        league_service.data_provider.get_totals_df.return_value = None
        
        with pytest.raises(ResourceNotFoundError, match="Unable to fetch totals data from ESPN API"):
            league_service.get_league_shots_data()


class TestLeagueServiceIntegration:
    """Integration tests for LeagueService with mocked data provider but real response building"""
    
    @pytest.fixture
    def integration_league_service(self, sample_averages_df, sample_totals_df):
        """Create LeagueService with mocked DataProvider and StatsCalculator but real ResponseBuilder"""
        with patch('app.services.league_service.DataProvider') as mock_data_provider, \
             patch('app.services.league_service.StatsCalculator') as mock_stats_calculator:
            service = LeagueService()
            service.data_provider = mock_data_provider.return_value
            service.stats_calculator = mock_stats_calculator.return_value
            
            # Mock data provider
            service.data_provider.get_averages_df.return_value = sample_averages_df
            service.data_provider.get_totals_df.return_value = sample_totals_df
            
            # Mock stats calculator with realistic results
            service.stats_calculator.find_category_leaders.return_value = {
                'PTS': {'team_id': 2}  # Team Beta has highest PTS
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
    
    def test_get_league_summary_real_response_building(self, integration_league_service):
        """Integration test: Verify real LeagueSummary response building"""
        league_summary = integration_league_service.get_league_summary()
        
        assert isinstance(league_summary, LeagueSummary), "Should return LeagueSummary object"
        assert league_summary.total_teams == 3, "Should have 3 teams"
        assert league_summary.total_games_played == 246, "Should sum all GP (82*3)"
    
    def test_get_heatmap_data_real_response_building(self, integration_league_service):
        """Integration test: Verify real HeatmapData response building"""
        heatmap_data = integration_league_service.get_heatmap_data()
        
        assert isinstance(heatmap_data, HeatmapData), "Should return HeatmapData object"
        assert len(heatmap_data.teams) == 3, "Should have 3 teams"
    
    def test_get_league_shots_data_real_response_building(self, integration_league_service):
        """Integration test: Verify real LeagueShotsData response building"""
        shots_data = integration_league_service.get_league_shots_data()
        
        assert isinstance(shots_data, LeagueShotsData), "Should return LeagueShotsData object"
        assert len(shots_data.shots) == 3, "Should have 3 team shot records"
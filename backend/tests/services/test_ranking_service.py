import pytest
from app.services.ranking_service import RankingService
import pandas as pd
from app.models.league import LeagueRankings
from app.exceptions import InvalidParameterError, ResourceNotFoundError
from unittest.mock import Mock, patch

@pytest.fixture
def ranking_service():
    with patch('app.services.ranking_service.DataProvider') as mock_data_provider, \
            patch('app.services.ranking_service.ResponseBuilder') as mock_response_builder:
        service = RankingService()
        service.data_provider = mock_data_provider.return_value
        service.response_builder = mock_response_builder.return_value
        return service

@pytest.fixture
def sample_rankings_df():
    """Sample rankings DataFrame for testing - matches ranking structure"""
    return pd.DataFrame({
        'team_id': [1, 2, 3],
        'team_name': ['Team Alpha', 'Team Beta', 'Team Gamma'],
        'FG%': [2, 3, 1],
        'FT%': [3, 1, 2],
        '3PM': [2, 1, 3],
        'AST': [2, 3, 1],
        'REB': [2, 3, 1],
        'STL': [2, 3, 1],
        'BLK': [3, 1, 2],
        'PTS': [2, 1, 3],
        'TOTAL_POINTS': [18, 17, 15],
        'RANK': [1, 2, 3]
    })

def test_get_league_rankings_success(ranking_service, sample_rankings_df):
    """Test successful league rankings retrieval"""
    expected_rankings = Mock(spec=LeagueRankings)
    
    ranking_service.data_provider.get_rankings_df.return_value = sample_rankings_df
    ranking_service.response_builder.build_rankings_response.return_value = expected_rankings
    
    result = ranking_service.get_league_rankings()
    
    assert result == expected_rankings
    ranking_service.data_provider.get_rankings_df.assert_called_once()
    ranking_service.response_builder.build_rankings_response.assert_called_once_with(
        sample_rankings_df, None, "asc" # default order is asc
    )
    
def test_get_league_rankings_with_sort_by(ranking_service, sample_rankings_df):
    """Test league rankings with sort_by parameter"""
    expected_rankings = Mock(spec=LeagueRankings)
    
    ranking_service.data_provider.get_rankings_df.return_value = sample_rankings_df
    ranking_service.response_builder.build_rankings_response.return_value = expected_rankings
    
    result = ranking_service.get_league_rankings(sort_by='FG%')
    
    assert result == expected_rankings
    ranking_service.response_builder.build_rankings_response.assert_called_once_with(
        sample_rankings_df, 'FG%', "asc"
    )

def test_get_league_rankings_with_order(ranking_service, sample_rankings_df):
    """Test league rankings with order parameter"""
    expected_rankings = Mock(spec=LeagueRankings)
    
    ranking_service.data_provider.get_rankings_df.return_value = sample_rankings_df
    ranking_service.response_builder.build_rankings_response.return_value = expected_rankings
    
    result = ranking_service.get_league_rankings(order='asc')
    
    assert result == expected_rankings
    ranking_service.response_builder.build_rankings_response.assert_called_once_with(
        sample_rankings_df, None, "asc"
    )

def test_get_league_rankings_with_sort_by_and_order(ranking_service, sample_rankings_df):
    """Test league rankings with both sort_by and order parameters"""
    expected_rankings = Mock(spec=LeagueRankings)
    
    ranking_service.data_provider.get_rankings_df.return_value = sample_rankings_df
    ranking_service.response_builder.build_rankings_response.return_value = expected_rankings
    
    result = ranking_service.get_league_rankings(sort_by='FG%', order='asc')
    
    assert result == expected_rankings
    ranking_service.response_builder.build_rankings_response.assert_called_once_with(
        sample_rankings_df, 'FG%', "asc"
    )


# Error handling tests
def test_get_league_rankings_data_provider_returns_none(ranking_service):
    """Test get_league_rankings when data provider returns None"""
    ranking_service.data_provider.get_rankings_df.return_value = None
    
    with pytest.raises(ResourceNotFoundError, match="Unable to fetch rankings data from ESPN API"):
        ranking_service.get_league_rankings()


def test_get_league_rankings_invalid_sort_column(ranking_service, sample_rankings_df):
    """Test get_league_rankings with invalid sort column"""
    ranking_service.data_provider.get_rankings_df.return_value = sample_rankings_df
    
    with pytest.raises(InvalidParameterError, match="Invalid sort column: INVALID_COLUMN"):
        ranking_service.get_league_rankings(sort_by='INVALID_COLUMN')


def test_get_league_rankings_invalid_order(ranking_service, sample_rankings_df):
    """Test get_league_rankings with invalid order parameter"""
    ranking_service.data_provider.get_rankings_df.return_value = sample_rankings_df
    
    with pytest.raises(InvalidParameterError, match="Order must be 'asc' or 'desc'"):
        ranking_service.get_league_rankings(order='invalid')

def test_is_valid_sort_column_case_insensitive(ranking_service, sample_rankings_df):
    """Test _is_valid_sort_column is case insensitive"""
    result = ranking_service._is_valid_sort_column('fg%', sample_rankings_df)
    assert result is True


# Integration test
class TestRankingServiceIntegration:
    """Integration tests for RankingService with mocked data provider but real response building"""
    
    @pytest.fixture
    def integration_ranking_service(self, sample_rankings_df):
        """Create RankingService with mocked DataProvider but real ResponseBuilder"""
        with patch('app.services.ranking_service.DataProvider') as mock_data_provider:
            service = RankingService()
            service.data_provider = mock_data_provider.return_value
            service.data_provider.get_rankings_df.return_value = sample_rankings_df
            return service
    
    def test_get_league_rankings_real_response_building(self, integration_ranking_service):
        """Integration test: Verify real LeagueRankings response building with default asc order by rank"""
        league_rankings = integration_ranking_service.get_league_rankings()
        
        assert isinstance(league_rankings, LeagueRankings), "Should return LeagueRankings object"
        assert len(league_rankings.rankings) == 3, "Should have 3 rankings from sample data"
        
        # Default should be sorted by RANK ascending (best rank first)
        # Sample data: Team Alpha=1, Team Beta=2, Team Gamma=3
        expected_ranks = [1, 2, 3]  # ascending order by default
        actual_ranks = [ranking.rank for ranking in league_rankings.rankings]
        assert actual_ranks == expected_ranks, f"Expected {expected_ranks}, got {actual_ranks}"
        
        expected_team_names = ['Team Alpha', 'Team Beta', 'Team Gamma']
        actual_team_names = [ranking.team.team_name for ranking in league_rankings.rankings]
        assert actual_team_names == expected_team_names, f"Expected {expected_team_names}, got {actual_team_names}"
        
        # Verify that the rankings data is properly populated
        first_ranking = league_rankings.rankings[0]
        assert first_ranking.team.team_id == 1, "First team should be Team Alpha (best rank)"
        assert first_ranking.rank == 1, "First ranking should have rank 1"
        assert first_ranking.total_points == 18, "Should have correct total points from sample data"
    
    def test_get_league_rankings_sorting_by_category(self, integration_ranking_service):
        """Integration test: Verify sorting by specific category works correctly"""
        league_rankings = integration_ranking_service.get_league_rankings(sort_by='FG%', order='desc')
        
        # Sample FG% data: Team Alpha=2, Team Beta=3, Team Gamma=1
        # Descending order should be: Team Beta(3), Team Alpha(2), Team Gamma(1)
        expected_fg_values = [3, 2, 1]
        actual_fg_values = [ranking.fg_percentage for ranking in league_rankings.rankings]
        assert actual_fg_values == expected_fg_values, f"Expected {expected_fg_values}, got {actual_fg_values}"
        
        expected_team_names = ['Team Beta', 'Team Alpha', 'Team Gamma']
        actual_team_names = [ranking.team.team_name for ranking in league_rankings.rankings]
        assert actual_team_names == expected_team_names, f"Expected {expected_team_names}, got {actual_team_names}"
    
    def test_get_league_rankings_asc_order(self, integration_ranking_service):
        """Integration test: Verify ascending order works correctly"""
        league_rankings = integration_ranking_service.get_league_rankings(order='asc')
        
        expected_ranks = [1, 2, 3]
        actual_ranks = [ranking.rank for ranking in league_rankings.rankings]
        assert actual_ranks == expected_ranks, f"Expected {expected_ranks}, got {actual_ranks}"
        
        expected_team_names = ['Team Alpha', 'Team Beta', 'Team Gamma']
        actual_team_names = [ranking.team.team_name for ranking in league_rankings.rankings]
        assert actual_team_names == expected_team_names, f"Expected {expected_team_names}, got {actual_team_names}"
    
    def test_get_league_rankings_desc_order_by_total_points(self, integration_ranking_service):
        """Integration test: Verify descending order by TOTAL_POINTS"""
        league_rankings = integration_ranking_service.get_league_rankings(sort_by='TOTAL_POINTS', order='desc')
        
        expected_total_points = [18, 17, 15]
        actual_total_points = [ranking.total_points for ranking in league_rankings.rankings]
        assert actual_total_points == expected_total_points, f"Expected {expected_total_points}, got {actual_total_points}"
        
        expected_team_names = ['Team Alpha', 'Team Beta', 'Team Gamma']
        actual_team_names = [ranking.team.team_name for ranking in league_rankings.rankings]
        assert actual_team_names == expected_team_names, f"Expected {expected_team_names}, got {actual_team_names}"

        


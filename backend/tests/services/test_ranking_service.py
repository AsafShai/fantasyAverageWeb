import pytest
import pytest_asyncio
from app.services.ranking_service import RankingService
import pandas as pd
from app.models.league import LeagueRankings
from app.models.stats import RankingStats
from app.exceptions import InvalidParameterError, ResourceNotFoundError
from unittest.mock import Mock, patch, AsyncMock

@pytest.fixture
def ranking_service():
    with patch('app.services.ranking_service.DataProvider') as mock_data_provider, \
            patch('app.services.ranking_service.ResponseBuilder') as mock_response_builder:
        service = RankingService()
        service.data_provider = AsyncMock()
        service.response_builder = mock_response_builder.return_value
        return service


@pytest.mark.asyncio
async def test_get_league_rankings_success(ranking_service, sample_rankings_df):
    """Test successful league rankings retrieval"""
    expected_rankings = Mock(spec=LeagueRankings)
    
    ranking_service.data_provider.get_rankings_df.return_value = sample_rankings_df
    ranking_service.response_builder.build_rankings_response.return_value = expected_rankings
    
    result = await ranking_service.get_league_rankings()
    
    assert result == expected_rankings
    ranking_service.data_provider.get_rankings_df.assert_called_once()
    ranking_service.response_builder.build_rankings_response.assert_called_once_with(
        sample_rankings_df, None, "asc" # default order is asc
    )
    
@pytest.mark.asyncio
async def test_get_league_rankings_with_sort_by(ranking_service, sample_rankings_df):
    """Test league rankings with sort_by parameter"""
    expected_rankings = Mock(spec=LeagueRankings)
    
    ranking_service.data_provider.get_rankings_df.return_value = sample_rankings_df
    ranking_service.response_builder.build_rankings_response.return_value = expected_rankings
    
    result = await ranking_service.get_league_rankings(sort_by='FG%')
    
    assert result == expected_rankings
    ranking_service.response_builder.build_rankings_response.assert_called_once_with(
        sample_rankings_df, 'FG%', "asc"
    )

@pytest.mark.asyncio
async def test_get_league_rankings_with_order(ranking_service, sample_rankings_df):
    """Test league rankings with order parameter"""
    expected_rankings = Mock(spec=LeagueRankings)
    
    ranking_service.data_provider.get_rankings_df.return_value = sample_rankings_df
    ranking_service.response_builder.build_rankings_response.return_value = expected_rankings
    
    result = await ranking_service.get_league_rankings(order='asc')
    
    assert result == expected_rankings
    ranking_service.response_builder.build_rankings_response.assert_called_once_with(
        sample_rankings_df, None, "asc"
    )

@pytest.mark.asyncio
async def test_get_league_rankings_with_sort_by_and_order(ranking_service, sample_rankings_df):
    """Test league rankings with both sort_by and order parameters"""
    expected_rankings = Mock(spec=LeagueRankings)
    
    ranking_service.data_provider.get_rankings_df.return_value = sample_rankings_df
    ranking_service.response_builder.build_rankings_response.return_value = expected_rankings
    
    result = await ranking_service.get_league_rankings(sort_by='FG%', order='asc')
    
    assert result == expected_rankings
    ranking_service.response_builder.build_rankings_response.assert_called_once_with(
        sample_rankings_df, 'FG%', "asc"
    )


@pytest.mark.asyncio
async def test_get_league_rankings_data_provider_returns_none(ranking_service):
    """Test get_league_rankings when data provider returns None"""
    ranking_service.data_provider.get_rankings_df.return_value = None
    
    with pytest.raises(ResourceNotFoundError, match="Unable to fetch rankings data from ESPN API"):
        await ranking_service.get_league_rankings()


@pytest.mark.asyncio
async def test_get_league_rankings_invalid_sort_column(ranking_service, sample_rankings_df):
    """Test get_league_rankings with invalid sort column"""
    ranking_service.data_provider.get_rankings_df.return_value = sample_rankings_df
    
    with pytest.raises(InvalidParameterError, match="Invalid sort column: INVALID_COLUMN"):
        await ranking_service.get_league_rankings(sort_by='INVALID_COLUMN')


@pytest.mark.asyncio
async def test_get_league_rankings_invalid_order(ranking_service, sample_rankings_df):
    """Test get_league_rankings with invalid order parameter"""
    ranking_service.data_provider.get_rankings_df.return_value = sample_rankings_df
    
    with pytest.raises(InvalidParameterError, match="Order must be 'asc' or 'desc'"):
        await ranking_service.get_league_rankings(order='invalid')

def test_is_valid_sort_column_case_insensitive(ranking_service, sample_rankings_df):
    """Test _is_valid_sort_column is case insensitive"""
    result = ranking_service._is_valid_sort_column('fg%', sample_rankings_df)
    assert result is True


# Integration test
class TestRankingServiceResponseBuilding:
    """Response building tests for RankingService with mocked data provider but real response building"""
    
    @pytest.fixture
    def response_building_ranking_service(self, sample_rankings_df):
        """Create RankingService with mocked DataProvider but real ResponseBuilder"""
        with patch('app.services.ranking_service.DataProvider') as mock_data_provider:
            service = RankingService()
            service.data_provider = AsyncMock()
            service.data_provider.get_rankings_df.return_value = sample_rankings_df
            return service
    
    @pytest.mark.asyncio
    async def test_get_league_rankings_response_building(self, response_building_ranking_service):
        """Integration test: Verify real LeagueRankings response building with default asc order by rank"""
        league_rankings = await response_building_ranking_service.get_league_rankings()
        
        assert isinstance(league_rankings, LeagueRankings), "Should return LeagueRankings object"
        assert len(league_rankings.rankings) == 3, "Should have 3 rankings from sample data"
        
        # Default should be sorted by RANK ascending (best rank first)
        expected_ranks = [1, 2, 3]  # ascending order by default
        actual_ranks = [ranking.rank for ranking in league_rankings.rankings]
        assert actual_ranks == expected_ranks, f"Expected {expected_ranks}, got {actual_ranks}"
        
        expected_team_names = ['Team Alpha', 'Team Beta', 'Team Gamma']
        actual_team_names = [ranking.team.team_name for ranking in league_rankings.rankings]
        assert actual_team_names == expected_team_names, f"Expected {expected_team_names}, got {actual_team_names}"
        
        first_ranking = league_rankings.rankings[0]
        assert first_ranking.team.team_id == 1, "First team should be Team Alpha (best rank)"
        assert first_ranking.rank == 1, "First ranking should have rank 1"
        assert first_ranking.total_points == 18, "Should have correct total points from sample data"
    
    @pytest.mark.asyncio
    async def test_get_league_rankings_sorting_by_category(self, response_building_ranking_service):
        """Integration test: Verify sorting by specific category works correctly"""
        league_rankings = await response_building_ranking_service.get_league_rankings(sort_by='FG%', order='desc')
        
        expected_fg_values = [3, 2, 1]
        actual_fg_values = [ranking.fg_percentage for ranking in league_rankings.rankings]
        assert actual_fg_values == expected_fg_values, f"Expected {expected_fg_values}, got {actual_fg_values}"
        
        expected_team_names = ['Team Beta', 'Team Alpha', 'Team Gamma']
        actual_team_names = [ranking.team.team_name for ranking in league_rankings.rankings]
        assert actual_team_names == expected_team_names, f"Expected {expected_team_names}, got {actual_team_names}"
    
    @pytest.mark.asyncio
    async def test_get_league_rankings_asc_order(self, response_building_ranking_service):
        """Integration test: Verify ascending order works correctly"""
        league_rankings = await response_building_ranking_service.get_league_rankings(order='asc')
        
        expected_ranks = [1, 2, 3]
        actual_ranks = [ranking.rank for ranking in league_rankings.rankings]
        assert actual_ranks == expected_ranks, f"Expected {expected_ranks}, got {actual_ranks}"
        
        expected_team_names = ['Team Alpha', 'Team Beta', 'Team Gamma']
        actual_team_names = [ranking.team.team_name for ranking in league_rankings.rankings]
        assert actual_team_names == expected_team_names, f"Expected {expected_team_names}, got {actual_team_names}"
    
    @pytest.mark.asyncio
    async def test_get_league_rankings_desc_order_by_total_points(self, response_building_ranking_service):
        """Integration test: Verify descending order by TOTAL_POINTS"""
        league_rankings = await response_building_ranking_service.get_league_rankings(sort_by='TOTAL_POINTS', order='desc')
        
        expected_total_points = [18, 17, 15]
        actual_total_points = [ranking.total_points for ranking in league_rankings.rankings]
        assert actual_total_points == expected_total_points, f"Expected {expected_total_points}, got {actual_total_points}"
        
        expected_team_names = ['Team Alpha', 'Team Beta', 'Team Gamma']
        actual_team_names = [ranking.team.team_name for ranking in league_rankings.rankings]
        assert actual_team_names == expected_team_names, f"Expected {expected_team_names}, got {actual_team_names}"


class TestRankingServiceIntegration:
    """True integration tests for RankingService with real component interaction"""
    
    @pytest_asyncio.fixture
    async def integration_ranking_service(self):
        """Create RankingService with real dependencies working together"""
        from app.services.ranking_service import RankingService
        service = RankingService()
        
        try:
            yield service
        finally:
            if hasattr(service.data_provider, '_client'):
                await service.data_provider.close()
    
    @pytest.mark.asyncio
    async def test_integration_ranking_data_flow(self, integration_ranking_service):
        """Test complete data flow: DataProvider -> ResponseBuilder for rankings"""
        league_rankings = await integration_ranking_service.get_league_rankings()
        
        assert isinstance(league_rankings, LeagueRankings)
        assert len(league_rankings.rankings) == 3  # Sample data has 3 teams
        
        rankings = league_rankings.rankings
        for i in range(len(rankings) - 1):
            # Default sort is by rank ascending (best ranks first)
            assert rankings[i].rank <= rankings[i + 1].rank
        
        for ranking in rankings:
            assert isinstance(ranking, RankingStats)
            assert hasattr(ranking, 'team')
            assert hasattr(ranking, 'pts')
            assert hasattr(ranking, 'ast')
            assert hasattr(ranking, 'reb')
            assert hasattr(ranking, 'rank')
            assert ranking.rank is not None  # Should have calculated ranks
    
    @pytest.mark.asyncio
    async def test_integration_sorting_functionality(self, integration_ranking_service):
        """Test that sorting parameters actually affect the service pipeline"""
        league_rankings = await integration_ranking_service.get_league_rankings(
            sort_by='PTS', order='desc'
        )
        
        assert isinstance(league_rankings, LeagueRankings)
        rankings = league_rankings.rankings
        
        pts_values = [ranking.pts for ranking in rankings]
        assert pts_values == sorted(pts_values, reverse=True), "PTS should be in descending order"
        
        league_rankings_asc = await integration_ranking_service.get_league_rankings(
            sort_by='AST', order='asc'
        )
        
        rankings_asc = league_rankings_asc.rankings
        ast_values = [ranking.ast for ranking in rankings_asc]
        assert ast_values == sorted(ast_values), "AST should be in ascending order"
    
    @pytest.mark.asyncio
    async def test_integration_error_handling(self, integration_ranking_service):
        """Test that invalid parameters are properly handled through the pipeline"""
        from app.exceptions import InvalidParameterError
        
        with pytest.raises(InvalidParameterError, match="Invalid sort column"):
            await integration_ranking_service.get_league_rankings(sort_by='INVALID_STAT')
        
        with pytest.raises(InvalidParameterError, match="Order must be 'asc' or 'desc'"):
            await integration_ranking_service.get_league_rankings(order='invalid_order')

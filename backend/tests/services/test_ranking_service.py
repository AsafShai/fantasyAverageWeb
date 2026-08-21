import pytest
import pytest_asyncio
from app.services.ranking_service import RankingService
import pandas as pd
from app.models.league import LeagueRankings
from app.models.stats import RankingStats
from app.exceptions import InvalidParameterError, ResourceNotFoundError
from unittest.mock import Mock, patch, AsyncMock, MagicMock


@pytest.fixture
def ranking_service(sample_rankings_df, sample_totals_df):
    with patch('app.services.ranking_service.DataProvider') as mock_data_provider, \
            patch('app.services.ranking_service.ResponseBuilder') as mock_response_builder:
        service = RankingService()
        service.data_provider = AsyncMock()
        service.data_provider.get_data_date = MagicMock(return_value=None)
        service.data_provider.get_all_dataframes.return_value = (sample_totals_df, None, sample_rankings_df)
        service.response_builder = mock_response_builder.return_value
        return service


@pytest.mark.asyncio
async def test_get_league_rankings_success(ranking_service, sample_rankings_df):
    """Test successful league rankings retrieval"""
    expected_rankings = Mock(spec=LeagueRankings)

    ranking_service.response_builder.build_rankings_response.return_value = expected_rankings

    result = await ranking_service.get_league_rankings()

    assert result == expected_rankings
    ranking_service.data_provider.get_all_dataframes.assert_called_once()
    ranking_service.response_builder.build_rankings_response.assert_called_once()


@pytest.mark.asyncio
async def test_get_league_rankings_with_sort_by(ranking_service, sample_rankings_df):
    """Test league rankings with sort_by parameter"""
    expected_rankings = Mock(spec=LeagueRankings)

    ranking_service.response_builder.build_rankings_response.return_value = expected_rankings

    result = await ranking_service.get_league_rankings(sort_by='FG%')

    assert result == expected_rankings
    call_kwargs = ranking_service.response_builder.build_rankings_response.call_args
    assert call_kwargs.kwargs.get('sort_by') == 'FG%'


@pytest.mark.asyncio
async def test_get_league_rankings_with_order(ranking_service, sample_rankings_df):
    """Test league rankings with order parameter"""
    expected_rankings = Mock(spec=LeagueRankings)

    ranking_service.response_builder.build_rankings_response.return_value = expected_rankings

    result = await ranking_service.get_league_rankings(order='asc')

    assert result == expected_rankings
    call_kwargs = ranking_service.response_builder.build_rankings_response.call_args
    assert call_kwargs.kwargs.get('order') == 'asc'


@pytest.mark.asyncio
async def test_get_league_rankings_with_sort_by_and_order(ranking_service, sample_rankings_df):
    """Test league rankings with both sort_by and order parameters"""
    expected_rankings = Mock(spec=LeagueRankings)

    ranking_service.response_builder.build_rankings_response.return_value = expected_rankings

    result = await ranking_service.get_league_rankings(sort_by='FG%', order='asc')

    assert result == expected_rankings
    call_kwargs = ranking_service.response_builder.build_rankings_response.call_args
    assert call_kwargs.kwargs.get('sort_by') == 'FG%'
    assert call_kwargs.kwargs.get('order') == 'asc'


@pytest.mark.asyncio
async def test_get_league_rankings_data_provider_returns_none(ranking_service):
    """Test get_league_rankings when data provider returns None"""
    ranking_service.data_provider.get_all_dataframes.return_value = (None, None, None)

    with pytest.raises(ResourceNotFoundError, match="Unable to fetch rankings data from ESPN API"):
        await ranking_service.get_league_rankings()


@pytest.mark.asyncio
async def test_get_league_rankings_invalid_sort_column(ranking_service, sample_rankings_df):
    """Test get_league_rankings with invalid sort column"""
    with pytest.raises(InvalidParameterError, match="Invalid sort column: INVALID_COLUMN"):
        await ranking_service.get_league_rankings(sort_by='INVALID_COLUMN')


@pytest.mark.asyncio
async def test_get_league_rankings_invalid_order(ranking_service, sample_rankings_df):
    """Test get_league_rankings with invalid order parameter"""
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
    def response_building_ranking_service(self, sample_rankings_df, sample_totals_df, sample_averages_df):
        """Create RankingService with mocked DataProvider but real ResponseBuilder"""
        with patch('app.services.ranking_service.DataProvider') as mock_data_provider:
            service = RankingService()
            service.data_provider = AsyncMock()
            service.data_provider.get_all_dataframes.return_value = (sample_totals_df, sample_averages_df, sample_rankings_df)
            service.data_provider.get_data_date = MagicMock(return_value=None)
            from app.utils.constants import RANKING_CATEGORIES
            service.data_provider.get_ranking_categories.return_value = list(RANKING_CATEGORIES)
            return service

    @pytest.mark.asyncio
    async def test_get_league_rankings_response_building(self, response_building_ranking_service):
        """Integration test: Verify real LeagueRankings response building with default asc order by rank"""
        league_rankings = await response_building_ranking_service.get_league_rankings()

        assert isinstance(league_rankings, LeagueRankings), "Should return LeagueRankings object"
        assert len(league_rankings.averages_rankings) == 3, "Should have 3 rankings from sample data"

        expected_ranks = [1, 2, 3]
        actual_ranks = [ranking.rank for ranking in league_rankings.averages_rankings]
        assert actual_ranks == expected_ranks, f"Expected {expected_ranks}, got {actual_ranks}"

        expected_team_names = ['Team Alpha', 'Team Beta', 'Team Gamma']
        actual_team_names = [ranking.team.team_name for ranking in league_rankings.averages_rankings]
        assert actual_team_names == expected_team_names, f"Expected {expected_team_names}, got {actual_team_names}"

        first_ranking = league_rankings.averages_rankings[0]
        assert first_ranking.team.team_id == 1, "First team should be Team Alpha (best rank)"
        assert first_ranking.rank == 1, "First ranking should have rank 1"
        assert first_ranking.total_points == 18, "Should have correct total points from sample data"

    @pytest.mark.asyncio
    async def test_get_league_rankings_sorting_by_category(self, response_building_ranking_service):
        """Integration test: Verify sorting by specific category works correctly"""
        league_rankings = await response_building_ranking_service.get_league_rankings(sort_by='FG%', order='desc')

        expected_fg_ranks = [3, 2, 1]
        actual_fg_ranks = [ranking.category_ranks['FG%'] for ranking in league_rankings.averages_rankings]
        assert actual_fg_ranks == expected_fg_ranks, f"Expected {expected_fg_ranks}, got {actual_fg_ranks}"

        expected_team_names = ['Team Beta', 'Team Alpha', 'Team Gamma']
        actual_team_names = [ranking.team.team_name for ranking in league_rankings.averages_rankings]
        assert actual_team_names == expected_team_names, f"Expected {expected_team_names}, got {actual_team_names}"

    @pytest.mark.asyncio
    async def test_get_league_rankings_asc_order(self, response_building_ranking_service):
        """Integration test: Verify ascending order works correctly"""
        league_rankings = await response_building_ranking_service.get_league_rankings(order='asc')

        expected_ranks = [1, 2, 3]
        actual_ranks = [ranking.rank for ranking in league_rankings.averages_rankings]
        assert actual_ranks == expected_ranks, f"Expected {expected_ranks}, got {actual_ranks}"

        expected_team_names = ['Team Alpha', 'Team Beta', 'Team Gamma']
        actual_team_names = [ranking.team.team_name for ranking in league_rankings.averages_rankings]
        assert actual_team_names == expected_team_names, f"Expected {expected_team_names}, got {actual_team_names}"

    @pytest.mark.asyncio
    async def test_get_league_rankings_desc_order_by_total_points(self, response_building_ranking_service):
        """Integration test: Verify descending order by TOTAL_POINTS"""
        league_rankings = await response_building_ranking_service.get_league_rankings(sort_by='TOTAL_POINTS', order='desc')

        expected_total_points = [18, 17, 15]
        actual_total_points = [ranking.total_points for ranking in league_rankings.averages_rankings]
        assert actual_total_points == expected_total_points, f"Expected {expected_total_points}, got {actual_total_points}"

        expected_team_names = ['Team Alpha', 'Team Beta', 'Team Gamma']
        actual_team_names = [ranking.team.team_name for ranking in league_rankings.averages_rankings]
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
        assert len(league_rankings.averages_rankings) == 3

        rankings = league_rankings.averages_rankings
        for i in range(len(rankings) - 1):
            assert rankings[i].rank <= rankings[i + 1].rank

        for ranking in rankings:
            assert isinstance(ranking, RankingStats)
            assert hasattr(ranking, 'team')
            assert hasattr(ranking, 'pts')
            assert hasattr(ranking, 'ast')
            assert hasattr(ranking, 'reb')
            assert hasattr(ranking, 'rank')
            assert ranking.rank is not None

    @pytest.mark.asyncio
    async def test_integration_sorting_functionality(self, integration_ranking_service):
        """Test that sorting parameters actually affect the service pipeline"""
        league_rankings = await integration_ranking_service.get_league_rankings(
            sort_by='PTS', order='desc'
        )

        assert isinstance(league_rankings, LeagueRankings)
        rankings = league_rankings.averages_rankings

        pts_ranks = [ranking.category_ranks['PTS'] for ranking in rankings]
        assert pts_ranks == sorted(pts_ranks, reverse=True), "PTS rank-in-category should be in descending order"

        league_rankings_asc = await integration_ranking_service.get_league_rankings(
            sort_by='AST', order='asc'
        )

        rankings_asc = league_rankings_asc.averages_rankings
        ast_ranks = [ranking.category_ranks['AST'] for ranking in rankings_asc]
        assert ast_ranks == sorted(ast_ranks), "AST rank-in-category should be in ascending order"

    @pytest.mark.asyncio
    async def test_integration_error_handling(self, integration_ranking_service):
        """Test that invalid parameters are properly handled through the pipeline"""
        from app.exceptions import InvalidParameterError

        with pytest.raises(InvalidParameterError, match="Invalid sort column"):
            await integration_ranking_service.get_league_rankings(sort_by='INVALID_STAT')

        with pytest.raises(InvalidParameterError, match="Order must be 'asc' or 'desc'"):
            await integration_ranking_service.get_league_rankings(order='invalid_order')


@pytest.mark.real_dataprovider
class TestDynamicCategoriesEndToEnd:
    """Full pipeline test: a real (unmocked) DataProvider + DataTransformer +
    StatsCalculator + ResponseBuilder, with only the ESPN HTTP call stubbed,
    proving a league that scores turnovers on top of the default 8 categories
    actually surfaces TO through RankingService.get_league_rankings()."""

    @staticmethod
    def _turnovers_league_payload():
        def team(team_id, name, pts, to):
            return {
                "id": team_id,
                "name": name,
                "valuesByStat": {
                    "0": pts, "1": 20, "2": 50, "3": 200, "6": 400,
                    "13": 400, "14": 850, "15": 150, "16": 200, "17": 100,
                    "19": 47.1, "20": 75.0, "42": 82, "40": 2000, "11": to,
                },
            }
        return {
            "scoringPeriodId": 5,
            "teams": [team(1, "Alpha", 1000, 120), team(2, "Beta", 1100, 90)],
            "settings": {"scoringSettings": {"scoringItems": [
                {"statId": sid} for sid in (19, 20, 17, 3, 6, 2, 1, 0, 11)
            ]}},
        }

    @pytest_asyncio.fixture
    async def real_ranking_service(self):
        from app.services.data_provider import DataProvider
        from unittest.mock import AsyncMock, MagicMock

        DataProvider._instance = None
        DataProvider._initialized = False
        service = RankingService()
        service.data_provider = DataProvider()
        service.data_provider.db_service = AsyncMock()

        resp = MagicMock()
        resp.status_code = 200
        resp.headers = {"ETag": "e1"}
        resp.json.return_value = self._turnovers_league_payload()
        resp.raise_for_status = MagicMock()
        service.data_provider._client.get = AsyncMock(return_value=resp)

        yield service
        DataProvider._instance = None
        DataProvider._initialized = False

    @pytest.mark.asyncio
    async def test_turnovers_category_flows_through_to_response(self, real_ranking_service):
        result = await real_ranking_service.get_league_rankings()

        assert 'TO' in result.categories
        beta = next(r for r in result.averages_rankings if r.team.team_name == 'Beta')
        assert beta.stats['TO'] == pytest.approx(90 / 82)
        assert 'TO' in beta.category_ranks
        # Beta has fewer turnovers (better) than Alpha -> should rank 1st in TO
        assert beta.category_ranks['TO'] == 1

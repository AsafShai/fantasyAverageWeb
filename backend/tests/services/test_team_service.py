import pytest
import pandas as pd
from unittest.mock import Mock, patch
from app.services.team_service import TeamService
from app.models import Team, TeamDetail, TeamPlayers
from app.exceptions import ResourceNotFoundError

@pytest.fixture
def team_service():
    """Create TeamService instance with mocked dependencies"""
    with patch('app.services.team_service.DataProvider') as mock_data_provider, \
            patch('app.services.team_service.ResponseBuilder') as mock_response_builder:
        service = TeamService()
        service.data_provider = mock_data_provider.return_value
        service.response_builder = mock_response_builder.return_value
        return service

@pytest.fixture
def sample_totals_df():
    """Sample totals DataFrame for testing - matches ESPN data structure"""
    return pd.DataFrame({
        'team_id': [1, 2, 3],
        'team_name': ['Team Alpha', 'Team Beta', 'Team Gamma'],
        'FGM': [3842, 3756, 3699],
        'FGA': [8234, 8456, 8123],
        'FG%': [46.7, 44.4, 45.5],
        'FTM': [1523, 1645, 1456],
        'FTA': [2034, 2156, 1923],
        'FT%': [74.9, 76.3, 75.7],
        '3PM': [1245, 1367, 1123],
        'AST': [2345, 2267, 2456],
        'REB': [3567, 3423, 3678],
        'STL': [756, 689, 823],
        'BLK': [456, 534, 423],
        'PTS': [9452, 9924, 8977],
        'GP': [82, 82, 82]
    })

@pytest.fixture
def sample_averages_df():
    """Sample averages DataFrame for testing - matches per-game structure"""
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

@pytest.fixture
def sample_players_df():
    """Sample players DataFrame for testing - matches player data structure"""
    return pd.DataFrame({
        'Name': ['Player A', 'Player B', 'Player C', 'Player D', 'Player E'],
        'team_id': [1, 1, 2, 2, 3],
        'Pro Team': ['LAL', 'LAL', 'GSW', 'GSW', 'BOS'],
        'Positions': ['PG, SG', 'SF, PF', 'PG', 'SG, SF', 'SF, PF'],
        'FGM': [456, 523, 467, 398, 445],
        'FGA': [1034, 1123, 998, 856, 967],
        'FG%': [44.1, 46.6, 46.8, 46.5, 46.0],
        'FTM': [167, 234, 189, 145, 178],
        'FTA': [223, 298, 234, 178, 223],
        'FT%': [74.9, 78.5, 80.8, 81.5, 79.8],
        '3PM': [134, 89, 167, 123, 98],
        'AST': [345, 178, 289, 234, 156],
        'REB': [234, 567, 289, 345, 456],
        'STL': [89, 67, 78, 56, 87],
        'BLK': [23, 134, 45, 34, 78],
        'PTS': [1213, 1369, 1290, 1064, 1166],
        'GP': [78, 82, 79, 75, 80]
    })

class TestTeamService:
    """Test suite for TeamService class"""
    
    
    def test_get_team_detail_success(self, team_service, sample_totals_df, sample_averages_df, sample_rankings_df):
        """Test successful team detail retrieval"""
        team_id = 1
        expected_team_detail = Mock(spec=TeamDetail)
        
        team_service.data_provider.get_all_dataframes.return_value = (
            sample_totals_df, sample_averages_df, sample_rankings_df
        )
        team_service.response_builder.build_team_detail_response.return_value = expected_team_detail
        
        result = team_service.get_team_detail(team_id)
        assert result == expected_team_detail
        team_service.data_provider.get_all_dataframes.assert_called_once()
        team_service.response_builder.build_team_detail_response.assert_called_once_with(
            team_id, sample_totals_df, sample_averages_df, sample_rankings_df
        )
    
    def test_get_team_detail_partial_none_data(self, team_service, sample_totals_df):
        """Test get_team_detail when only some dataframes are None"""
        team_id = 1
        team_service.data_provider.get_all_dataframes.return_value = (sample_totals_df, None, None)
        
        with pytest.raises(ResourceNotFoundError, match="Unable to process ESPN data"):
            team_service.get_team_detail(team_id)
    
    def test_get_team_detail_team_not_found(self, team_service, sample_totals_df, sample_averages_df, sample_rankings_df):
        """Test get_team_detail when team ID doesn't exist"""
        team_id = 999
        team_service.data_provider.get_all_dataframes.return_value = (
            sample_totals_df, sample_averages_df, sample_rankings_df
        )
        
        with pytest.raises(ResourceNotFoundError, match=f"Team with ID {team_id} not found"):
            team_service.get_team_detail(team_id)
    
    def test_get_teams_list_success(self, team_service, sample_totals_df):
        """Test successful teams list retrieval"""
        
        team_service.data_provider.get_totals_df.return_value = sample_totals_df
        
        result = team_service.get_teams_list()
        
        assert len(result) == 3
        assert all(isinstance(team, Team) for team in result)
        for team in result:
            assert team.team_id in [1, 2, 3]
            assert team.team_name in ['Team Alpha', 'Team Beta', 'Team Gamma']
        team_service.data_provider.get_totals_df.assert_called_once()
    
    def test_get_teams_list_data_provider_returns_none(self, team_service):
        """Test get_teams_list when data provider returns None"""
        team_service.data_provider.get_totals_df.return_value = None
        
        with pytest.raises(Exception, match="Unable to fetch teams data from ESPN API"):
            team_service.get_teams_list()
    
    def test_get_teams_list_empty_data(self, team_service):
        """Test get_teams_list with empty DataFrame"""
        empty_df = pd.DataFrame({'team_id': [], 'team_name': []})
        team_service.data_provider.get_totals_df.return_value = empty_df
        
        with pytest.raises(ResourceNotFoundError, match="No teams found in the data"):
            team_service.get_teams_list()
    
    def test_get_team_players_success(self, team_service, sample_players_df):
        """Test successful team players retrieval"""
        team_id = 1
        expected_team_players = Mock(spec=TeamPlayers)
        
        team_service.data_provider.get_players_df.return_value = sample_players_df
        team_service.response_builder.build_team_players_response.return_value = expected_team_players
        
        result = team_service.get_team_players(team_id)
        assert result == expected_team_players
        team_service.response_builder.build_team_players_response.assert_called_once()
    
    def test_get_team_players_data_provider_returns_none(self, team_service):
        """Test get_team_players when data provider returns None"""
        team_service.data_provider.get_players_df.return_value = None
        
        with pytest.raises(Exception, match="Unable to process player data"):
            team_service.get_team_players(1)
    
    def test_get_team_players_no_players_found(self, team_service, sample_players_df):
        """Test get_team_players when no players found for team"""
        team_id = 999
        team_service.data_provider.get_players_df.return_value = sample_players_df
        
        with pytest.raises(ResourceNotFoundError, match=f"No players found for team ID {team_id}"):
            team_service.get_team_players(team_id)


class TestTeamServiceIntegration:
    """Integration tests for TeamService with mocked data provider but real response building"""
    
    @pytest.fixture
    def integration_team_service(self, sample_totals_df, sample_averages_df, sample_rankings_df, sample_players_df):
        """Create TeamService with mocked DataProvider but real ResponseBuilder"""
        with patch('app.services.team_service.DataProvider') as mock_data_provider:
            service = TeamService()
            # Mock only the data provider to avoid API calls
            service.data_provider = mock_data_provider.return_value
            service.data_provider.get_totals_df.return_value = sample_totals_df
            service.data_provider.get_all_dataframes.return_value = (
                sample_totals_df, sample_averages_df, sample_rankings_df
            )
            service.data_provider.get_players_df.return_value = sample_players_df
            return service
    
    def test_get_teams_list_real_response_building(self, integration_team_service):
        """Integration test: Verify real response building with realistic data"""
        teams = integration_team_service.get_teams_list()
        
        assert len(teams) == 3, "Should return 3 teams from sample data"
        assert all(isinstance(team, Team) for team in teams), "All items should be Team objects"
        
        # Validate actual Team object structure and data
        expected_teams = {1: 'Team Alpha', 2: 'Team Beta', 3: 'Team Gamma'}
        for team in teams:
            assert team.team_id in expected_teams, f"Unexpected team_id: {team.team_id}"
            assert team.team_name == expected_teams[team.team_id], f"Team name mismatch for {team.team_id}"
            assert isinstance(team.team_id, int), "team_id should be integer"
            assert isinstance(team.team_name, str), "team_name should be string"
    
    def test_get_team_detail_real_response_building(self, integration_team_service):
        """Integration test: Verify real TeamDetail response building"""
        team_id = 1
        team_detail = integration_team_service.get_team_detail(team_id)
        
        assert isinstance(team_detail, TeamDetail), "Should return TeamDetail object"
        assert hasattr(team_detail, 'team'), "Should have team attribute"
        assert team_detail.team.team_id == team_id, "Should match requested team_id"
        
        # Verify that response builder actually processed the data
        assert team_detail.team.team_name == 'Team Alpha', "Should have correct team name"
        assert hasattr(team_detail, 'shot_chart'), "Should have shot_chart"
        assert hasattr(team_detail, 'raw_averages'), "Should have raw_averages"
        assert hasattr(team_detail, 'ranking_stats'), "Should have ranking_stats"
    
    def test_get_team_players_real_response_building(self, integration_team_service):
        """Integration test: Verify real TeamPlayers response building"""
        team_id = 1
        team_players = integration_team_service.get_team_players(team_id)
        
        assert isinstance(team_players, TeamPlayers), "Should return TeamPlayers object"
        assert hasattr(team_players, 'team_id'), "Should have team_id attribute"
        assert team_players.team_id == team_id, "Should match requested team_id"
        
        # Verify players data was actually processed by response builder
        assert hasattr(team_players, 'players'), "Should have players list"
        assert len(team_players.players) == 2, "Should have 2 players for team 1"
    
import pytest
import pandas as pd
from datetime import datetime
from app.builders.response_builder import ResponseBuilder
from app.models import (
    LeagueRankings, TeamDetail, LeagueSummary, HeatmapData, 
    LeagueShotsData, TeamPlayers, AverageStats, RankingStats, Team
)

@pytest.fixture
def response_builder():
    """Create ResponseBuilder instance"""
    return ResponseBuilder()

@pytest.fixture
def response_builder_players_df():
    """Sample players DataFrame specific to response builder tests - 2 players for team 1"""
    return pd.DataFrame({
        'Name': ['Player A', 'Player B'],
        'team_id': [1, 1],
        'Pro Team': ['LAL', 'LAL'],
        'Positions': ['PG, SG', 'SF, PF'],
        'FGM': [456, 523],
        'FGA': [1034, 1123],
        'FG%': [44.1, 46.6],
        'FTM': [167, 234],
        'FTA': [223, 298],
        'FT%': [74.9, 78.5],
        '3PM': [134, 89],
        'AST': [345, 178],
        'REB': [234, 567],
        'STL': [89, 67],
        'BLK': [23, 134],
        'PTS': [1213, 1369],
        'GP': [78, 82],
        'MIN': [2345.6, 2567.8]
    })


class TestResponseBuilder:
    """Test suite for ResponseBuilder class"""
    
    def test_build_rankings_response_default_sorting(self, response_builder, sample_rankings_df):
        """Test build_rankings_response with default sorting (by RANK, asc)"""
        result = response_builder.build_rankings_response(sample_rankings_df)
        
        assert isinstance(result, LeagueRankings), "Should return LeagueRankings object"
        assert len(result.rankings) == 3, "Should have 3 rankings"
        
        # Verify default sorting is by RANK ascending (best rank first)
        ranks = [ranking.rank for ranking in result.rankings]
        team_names = [ranking.team.team_name for ranking in result.rankings]
        
        assert ranks == [1, 2, 3], "Should be sorted by rank ascending (best rank first)"
        assert team_names == ['Team Alpha', 'Team Beta', 'Team Gamma'], "Should be in correct team order"
        
        first_ranking = result.rankings[0]
        assert first_ranking.team.team_id == 1, "First ranking should be Team Alpha"
        assert first_ranking.team.team_name == 'Team Alpha', "First ranking should be Team Alpha"
        assert first_ranking.rank == 1, "First ranking should have rank 1"
    
    def test_build_rankings_response_custom_sorting(self, response_builder, sample_rankings_df):
        """Test build_rankings_response with custom sorting by PTS descending"""
        result = response_builder.build_rankings_response(sample_rankings_df, sort_by='PTS', order='desc')
        
        # Descending order should be: Team Gamma(3), Team Alpha(2), Team Beta(1)
        pts_values = [ranking.pts for ranking in result.rankings]
        team_names = [ranking.team.team_name for ranking in result.rankings]
        
        assert pts_values == [3, 2, 1], "Should be sorted by PTS descending"
        assert team_names == ['Team Gamma', 'Team Alpha', 'Team Beta'], "Should be in correct PTS order"
    
    def test_build_rankings_response_ascending_order(self, response_builder, sample_rankings_df):
        """Test build_rankings_response with FG% ascending order"""
        result = response_builder.build_rankings_response(sample_rankings_df, sort_by='FG%', order='asc')
        
        # Ascending order should be: Team Gamma(1), Team Alpha(2), Team Beta(3)
        fg_values = [ranking.fg_percentage for ranking in result.rankings]
        team_names = [ranking.team.team_name for ranking in result.rankings]
        
        assert fg_values == [1, 2, 3], "Should be sorted by FG% ascending"
        assert team_names == ['Team Gamma', 'Team Alpha', 'Team Beta'], "Should be in correct FG% order"
    
    def test_build_rankings_response_total_points_sorting(self, response_builder, sample_rankings_df):
        """Test build_rankings_response with TOTAL_POINTS sorting"""
        result = response_builder.build_rankings_response(sample_rankings_df, sort_by='TOTAL_POINTS', order='desc')
        
        # Descending order should be: Team Alpha(18), Team Beta(17), Team Gamma(15)
        total_points = [ranking.total_points for ranking in result.rankings]
        team_names = [ranking.team.team_name for ranking in result.rankings]
        
        assert total_points == [18, 17, 15], "Should be sorted by TOTAL_POINTS descending"
        assert team_names == ['Team Alpha', 'Team Beta', 'Team Gamma'], "Should be in correct TOTAL_POINTS order"
    
    def test_build_team_detail_response_success(self, response_builder, sample_totals_df, sample_averages_df, sample_rankings_df):
        """Test successful team detail response building"""
        team_id = 1
        players = []  # Empty list for testing
        espn_url = "https://fantasy.espn.com/basketball/team"
        result = response_builder.build_team_detail_response(team_id, sample_totals_df, sample_averages_df, sample_rankings_df, players, espn_url)
        
        assert isinstance(result, TeamDetail), "Should return TeamDetail object"
        assert result.team.team_id == team_id, "Should have correct team_id"
        assert result.team.team_name == 'Team Alpha', "Should have correct team_name"
        
        assert hasattr(result, 'shot_chart'), "Should have shot_chart"
        assert hasattr(result, 'raw_averages'), "Should have raw_averages"
        assert hasattr(result, 'ranking_stats'), "Should have ranking_stats"
        assert hasattr(result, 'category_ranks'), "Should have category_ranks"
        
        assert result.shot_chart.fgm == 3842, "Should have correct FGM"
        assert result.shot_chart.fg_percentage == 46.7, "Should have correct FG%"
        
        assert isinstance(result.category_ranks, dict), "category_ranks should be dict"
        assert 'FG%' in result.category_ranks, "Should have FG% rank"
        assert result.category_ranks['FG%'] == 2, "Should have correct FG% rank"
    
    def test_build_team_detail_response_team_not_found(self, response_builder, sample_totals_df, sample_averages_df, sample_rankings_df):
        """Test build_team_detail_response with non-existent team"""
        team_id = 999
        players = []
        espn_url = "https://fantasy.espn.com/basketball/team"
        
        with pytest.raises(ValueError, match="Team '999' not found"):
            response_builder.build_team_detail_response(team_id, sample_totals_df, sample_averages_df, sample_rankings_df, players, espn_url)
    
    def test_build_league_summary_response_success(self, response_builder):
        """Test successful league summary response building"""
        total_teams = 30
        total_games_played = 2460
        category_leaders = {'PTS': RankingStats(
            team=Team(team_id=1, team_name='Team Alpha'), fg_percentage=0, ft_percentage=0, three_pm=0, ast=0, reb=0, stl=0, blk=0, pts=130.0, gp=82, total_points=0
        )}
        league_averages = AverageStats(
            fg_percentage=45.5, ft_percentage=75.0, three_pm=12.5, ast=25.0, reb=45.0, stl=8.0, blk=5.0, pts=112.0, gp=82
        )
        
        result = response_builder.build_league_summary_response(
            total_teams, total_games_played, category_leaders, league_averages
        )
        
        assert isinstance(result, LeagueSummary), "Should return LeagueSummary object"
        assert result.total_teams == 30, "Should have correct total_teams"
        assert result.total_games_played == 2460, "Should have correct total_games_played"
        assert result.category_leaders == category_leaders, "Should have correct category_leaders"
        assert result.league_averages == league_averages, "Should have correct league_averages"
        assert isinstance(result.last_updated, datetime), "Should have last_updated datetime"
    
    def test_build_heatmap_response_success(self, response_builder):
        """Test successful heatmap response building"""
        teams = [
            {'team_id': 1, 'team_name': 'Team Alpha'},
            {'team_id': 2, 'team_name': 'Team Beta'}
        ]
        categories = [[115.0, 28.0], [120.0, 25.0]]
        normalized_data = [[0.8, 0.9], [1.0, 0.7]]
        
        result = response_builder.build_heatmap_response(teams, categories, normalized_data)
        
        assert isinstance(result, HeatmapData), "Should return HeatmapData object"
        assert len(result.teams) == 2, "Should have 2 teams"
        assert result.teams[0].team_id == 1, "First team should have ID 1"
        assert result.teams[0].team_name == 'Team Alpha', "First team should be Team Alpha"
        assert result.data == categories, "Should have correct data"
        assert result.normalized_data == normalized_data, "Should have correct normalized_data"
        assert len(result.categories) == 9, "Should have 9 categories (8 ranking categories + GP)"
    
    def test_build_league_shots_response_success(self, response_builder):
        """Test successful league shots response building"""
        shots_data = [
            {
                'team_id': 1, 'team_name': 'Team Alpha',
                'fgm': 3842, 'fga': 8234, 'fg_percentage': 46.7,
                'ftm': 1523, 'fta': 2034, 'ft_percentage': 74.9,
                'gp': 82
            },
            {
                'team_id': 2, 'team_name': 'Team Beta',
                'fgm': 3756, 'fga': 8456, 'fg_percentage': 44.4,
                'ftm': 1645, 'fta': 2156, 'ft_percentage': 76.3,
                'gp': 82
            }
        ]
        
        result = response_builder.build_league_shots_response(shots_data)
        
        assert isinstance(result, LeagueShotsData), "Should return LeagueShotsData object"
        assert len(result.shots) == 2, "Should have 2 team shots"
        assert isinstance(result.last_updated, datetime), "Should have last_updated datetime"
        
        first_shot = result.shots[0]
        assert first_shot.team.team_id == 1, "First shot should be Team Alpha"
        assert first_shot.fgm == 3842, "Should have correct FGM"
        assert first_shot.fg_percentage == 46.7, "Should have correct FG%"
    
    def test_build_team_players_response_success(self, response_builder, response_builder_players_df):
        """Test successful team players response building"""
        result = response_builder.build_team_players_response(response_builder_players_df)
        
        assert isinstance(result, TeamPlayers), "Should return TeamPlayers object"
        assert result.team_id == 1, "Should have correct team_id"
        assert len(result.players) == 2, "Should have 2 players"
        assert isinstance(result.last_updated, datetime), "Should have last_updated datetime"
        
        first_player = result.players[0]
        assert first_player.player_name == 'Player A', "Should have correct player name"
        assert first_player.pro_team == 'LAL', "Should have correct pro team"
        assert first_player.positions == ['PG', 'SG'], "Should have correct positions"
        
        assert first_player.stats.pts == 1213.0, "Should have correct PTS"
        assert first_player.stats.gp == 78, "Should have correct GP"
    
    def test_create_average_stats_success(self, response_builder):
        """Test create_average_stats helper method"""
        league_avg_data = {
            'FG%': 45.5, 'FT%': 75.0, '3PM': 12.5, 'AST': 25.0,
            'REB': 45.0, 'STL': 8.0, 'BLK': 5.0, 'PTS': 112.0, 'GP': 82
        }
        
        result = response_builder.create_average_stats(league_avg_data)
        
        assert isinstance(result, AverageStats), "Should return AverageStats object"
        assert result.fg_percentage == 45.5, "Should have correct FG%"
        assert result.pts == 112.0, "Should have correct PTS"
        assert result.gp == 82, "Should have correct GP"
    
    def test_create_ranking_stats_from_averages_success(self, response_builder, sample_averages_df):
        """Test create_ranking_stats_from_averages helper method"""
        team_data = sample_averages_df.iloc[0]  # Team Alpha
        
        result = response_builder.create_ranking_stats_from_averages(team_data)
        
        assert isinstance(result, RankingStats), "Should return RankingStats object"
        assert result.team.team_id == 1, "Should have correct team_id"
        assert result.team.team_name == 'Team Alpha', "Should have correct team_name"
        assert result.fg_percentage == 46.7, "Should have correct FG%"
        assert result.pts == 115.3, "Should have correct PTS"
        assert result.total_points == 0.0, "Should have total_points as 0.0 for category leaders"
        assert result.rank is None, "Should have rank as None for category leaders"
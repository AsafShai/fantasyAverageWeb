import pytest
import pandas as pd
from app.services.stats_calculator import StatsCalculator


@pytest.fixture
def stats_calculator():
    """Create StatsCalculator instance"""
    return StatsCalculator()


@pytest.fixture
def sample_averages_df():
    """Sample averages DataFrame for testing - values create distinct rankings"""
    return pd.DataFrame({
        'team_id': [1, 2, 3],
        'team_name': ['Team Alpha', 'Team Beta', 'Team Gamma'],
        'FG%': [48.0, 44.0, 46.0],    # Team Alpha best (3), Gamma (2), Beta worst (1)
        'FT%': [76.0, 78.0, 74.0],    # Team Beta best (3), Alpha (2), Gamma worst (1)
        '3PM': [16.0, 18.0, 14.0],    # Team Beta best (3), Alpha (2), Gamma worst (1)
        'AST': [30.0, 26.0, 28.0],    # Team Alpha best (3), Gamma (2), Beta worst (1)
        'REB': [45.0, 40.0, 42.0],    # Team Alpha best (3), Gamma (2), Beta worst (1)
        'STL': [10.0, 8.0, 9.0],      # Team Alpha best (3), Gamma (2), Beta worst (1)
        'BLK': [6.0, 7.0, 5.0],       # Team Beta best (3), Alpha (2), Gamma worst (1)
        'PTS': [118.0, 122.0, 115.0], # Team Beta best (3), Alpha (2), Gamma worst (1)
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
        '3PM': [1245, 1367, 1123],
        'AST': [2345, 2267, 2456],
        'REB': [3567, 3423, 3678],
        'STL': [756, 689, 823],
        'BLK': [456, 534, 423],
        'PTS': [9452, 9924, 8977],
        'GP': [82, 82, 82]
    })


class TestStatsCalculator:
    """Test suite for StatsCalculator class"""
    
    def test_calculate_rankings_success(self, stats_calculator, sample_averages_df):
        """Test successful rankings calculation"""
        result = stats_calculator.calculate_rankings(sample_averages_df)
        
        # Verify structure
        assert isinstance(result, pd.DataFrame), "Should return DataFrame"
        assert 'TOTAL_POINTS' in result.columns, "Should have TOTAL_POINTS column"
        assert 'RANK' in result.columns, "Should have RANK column"
        assert 'team_id' in result.columns, "Should preserve team_id"
        assert 'team_name' in result.columns, "Should preserve team_name"
        assert len(result) == 3, "Should have 3 teams"
        
        # Verify ranking logic - higher total points = better rank
        sorted_by_rank = result.sort_values('RANK')
        assert sorted_by_rank.iloc[0]['TOTAL_POINTS'] >= sorted_by_rank.iloc[1]['TOTAL_POINTS'], "Rank 1 should have highest total points"
        
        # Verify ranks are consecutive integers starting from 1
        ranks = sorted(result['RANK'].tolist())
        assert ranks == [1, 2, 3], "Ranks should be 1, 2, 3"
    
    def test_calculate_rankings_empty_dataframe(self, stats_calculator):
        """Test calculate_rankings with empty DataFrame"""
        empty_df = pd.DataFrame()
        
        with pytest.raises(ValueError, match="Cannot calculate rankings for empty DataFrame"):
            stats_calculator.calculate_rankings(empty_df)
    
    def test_find_category_leaders_success(self, stats_calculator, sample_averages_df):
        """Test successful category leaders calculation"""
        result = stats_calculator.find_category_leaders(sample_averages_df)
        
        # Verify structure
        assert isinstance(result, dict), "Should return dictionary"
        assert len(result) > 0, "Should have category leaders"
        
        # Verify expected categories are present
        expected_categories = ['PTS_leader', '3PM_leader', 'AST_leader', 'REB_leader', 'STL_leader', 'BLK_leader']
        for category in expected_categories:
            assert category in result, f"Should have {category}"
            
            # Verify leader structure
            leader = result[category]
            assert 'team_id' in leader, "Leader should have team_id"
            assert 'team_name' in leader, "Leader should have team_name"
            assert 'value' in leader, "Leader should have value"
            assert isinstance(leader['team_id'], int), "team_id should be int"
            assert isinstance(leader['team_name'], str), "team_name should be str"
            assert isinstance(leader['value'], float), "value should be float"
        
        # Verify actual leaders based on sample data
        # Team Beta (id=2) has highest PTS (122.0)
        assert result['PTS_leader']['team_id'] == 2, "Team Beta should lead PTS"
        assert result['PTS_leader']['value'] == 122.0, "PTS leader value should be 122.0"
        
        # Team Alpha (id=1) has highest STL (10.0)
        assert result['STL_leader']['team_id'] == 1, "Team Alpha should lead STL"
        assert result['STL_leader']['value'] == 10.0, "STL leader value should be 10.0"
    
    def test_find_category_leaders_empty_dataframe(self, stats_calculator):
        """Test find_category_leaders with empty DataFrame"""
        empty_df = pd.DataFrame()
        result = stats_calculator.find_category_leaders(empty_df)
        
        assert result == {}, "Should return empty dict for empty DataFrame"
    
    def test_calculate_league_averages_success(self, stats_calculator, sample_averages_df):
        """Test successful league averages calculation"""
        result = stats_calculator.calculate_league_averages(sample_averages_df)
        
        # Verify structure
        assert isinstance(result, dict), "Should return dictionary"
        assert len(result) > 0, "Should have league averages"
        
        # Verify expected categories
        expected_categories = ['FG%', 'FT%', '3PM', 'AST', 'REB', 'STL', 'BLK', 'PTS', 'GP']
        for category in expected_categories:
            assert category in result, f"Should have {category}"
            assert isinstance(result[category], float), f"{category} should be float"
        
        # Verify calculation - PTS average should be (118.0 + 122.0 + 115.0) / 3 = 118.33
        expected_pts_avg = (118.0 + 122.0 + 115.0) / 3
        assert abs(result['PTS'] - expected_pts_avg) < 0.01, "PTS average should be correct"
        
        # Verify GP average should be 82 (all teams have 82 GP)
        assert result['GP'] == 82.0, "GP average should be 82.0"
    
    def test_calculate_league_averages_empty_dataframe(self, stats_calculator):
        """Test calculate_league_averages with empty DataFrame"""
        empty_df = pd.DataFrame()
        result = stats_calculator.calculate_league_averages(empty_df)
        
        assert result == {}, "Should return empty dict for empty DataFrame"
    
    def test_normalize_for_heatmap_success(self, stats_calculator, sample_averages_df):
        """Test successful heatmap normalization"""
        result = stats_calculator.normalize_for_heatmap(sample_averages_df)
        
        # Verify structure
        assert isinstance(result, list), "Should return list"
        assert len(result) == 3, "Should have 3 teams (rows)"
        assert all(isinstance(row, list) for row in result), "Each row should be a list"
        assert len(result[0]) == 8, "Each team should have 8 categories (RANKING_CATEGORIES)"
        
        # Verify normalization - all values should be between 0 and 1
        for row in result:
            for value in row:
                assert 0.0 <= value <= 1.0, f"Normalized value {value} should be between 0 and 1"
        
        # Verify that at least one value is 0 (min) and one is 1 (max) for each category
        transposed = list(map(list, zip(*result)))  # Transpose back to categories
        for category_values in transposed:
            assert min(category_values) == 0.0, "Each category should have a min value of 0.0"
            assert max(category_values) == 1.0, "Each category should have a max value of 1.0"
    
    def test_normalize_for_heatmap_empty_dataframe(self, stats_calculator):
        """Test normalize_for_heatmap with empty DataFrame"""
        empty_df = pd.DataFrame()
        result = stats_calculator.normalize_for_heatmap(empty_df)
        
        assert result == [], "Should return empty list for empty DataFrame"
    
    def test_normalize_for_heatmap_identical_values(self, stats_calculator):
        """Test normalize_for_heatmap with identical values (edge case)"""
        # Create DataFrame where all teams have same values for a category
        identical_df = pd.DataFrame({
            'team_id': [1, 2, 3],
            'team_name': ['A', 'B', 'C'],
            'FG%': [45.0, 45.0, 45.0],  
            'FT%': [75.0, 80.0, 70.0],  
            '3PM': [15.0, 15.0, 15.0],  
            'AST': [25.0, 30.0, 20.0],     
            'REB': [40.0, 40.0, 40.0],  
            'STL': [8.0, 9.0, 7.0],     
            'BLK': [5.0, 5.0, 5.0],    
            'PTS': [110.0, 115.0, 105.0] 
        })
        
        result = stats_calculator.normalize_for_heatmap(identical_df)
        
        # For identical values, should be normalized to 0.5
        transposed = list(map(list, zip(*result)))
        fg_values = transposed[0]  # FG% is first in RANKING_CATEGORIES
        assert all(v == 0.5 for v in fg_values), "Identical values should normalize to 0.5"
    
    def test_calculate_per_game_averages_success(self, stats_calculator, sample_totals_df):
        """Test successful per-game averages calculation"""
        result = stats_calculator.calculate_per_game_averages(sample_totals_df)
        
        # Verify structure
        assert isinstance(result, pd.DataFrame), "Should return DataFrame"
        assert len(result) == 3, "Should have 3 teams"
        assert 'team_id' in result.columns, "Should preserve team_id"
        assert 'team_name' in result.columns, "Should preserve team_name"
        
        # Verify raw counting stats are removed
        assert 'FGM' not in result.columns, "FGM should be removed"
        assert 'FGA' not in result.columns, "FGA should be removed"
        assert 'FTM' not in result.columns, "FTM should be removed"
        assert 'FTA' not in result.columns, "FTA should be removed"
        
        # Verify percentages are preserved
        assert 'FG%' in result.columns, "FG% should be preserved"
        assert 'FT%' in result.columns, "FT% should be preserved"
        
        # Verify per-game calculation
        team_alpha = result[result['team_id'] == 1].iloc[0]
        expected_3pm_avg = 1245 / 82
        assert abs(team_alpha['3PM'] - expected_3pm_avg) < 0.01, "3PM per-game calculation should be correct"
        
        # Verify PTS calculation
        expected_pts_avg = 9452 / 82
        assert abs(team_alpha['PTS'] - expected_pts_avg) < 0.01, "PTS per-game calculation should be correct"
    
    def test_calculate_per_game_averages_empty_dataframe(self, stats_calculator):
        """Test calculate_per_game_averages with empty DataFrame"""
        empty_df = pd.DataFrame()
        
        with pytest.raises(ValueError, match="Cannot calculate averages for empty DataFrame"):
            stats_calculator.calculate_per_game_averages(empty_df)
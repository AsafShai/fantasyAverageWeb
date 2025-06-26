import pandas as pd
from typing import Dict, List
from app.utils.constants import RANKING_CATEGORIES


class StatsCalculator:
    """Handles statistical calculations, rankings, and derived metrics"""
    
    def calculate_rankings(self, averages_df: pd.DataFrame) -> pd.DataFrame:
        """
        Calculate rankings from averages DataFrame
        Args:
            averages_df: DataFrame with per-game averages
        Returns:
            DataFrame with rankings and total points
        """
        # Create copy and remove non-ranking columns
        ranked = averages_df.copy()
        ranked.drop(['GP'], axis=1, inplace=True)
        
        # Rank each category (higher is better)
        ranked = ranked.rank()
        
        # Calculate total points (sum of all rankings)
        ranked['Total_Points'] = ranked.sum(axis=1)
        
        # Sort by total points (descending)
        ranked.sort_values(by='Total_Points', ascending=False, inplace=True)
        
        # Add overall rank
        ranked['Rank'] = ranked['Total_Points'].rank(method='min', ascending=False).astype(int)
        
        # Reset index to get Team as a column
        ranked.reset_index(inplace=True)
        
        return ranked
    
    def find_category_leaders(self, averages_df: pd.DataFrame) -> Dict:
        """
        Find the leader in each statistical category
        Args:
            averages_df: DataFrame with per-game averages
        Returns:
            Dictionary with category leaders
        """
        leaders = {}
        
        for category in RANKING_CATEGORIES:
            if category in averages_df.columns:
                # Find team with highest value in this category
                best_team = averages_df[category].idxmax()
                best_value = averages_df.loc[best_team, category]
                
                leaders[f'{category}_leader'] = {
                    'team': best_team,
                    'value': float(best_value)
                }
        
        return leaders
    
    def calculate_league_averages(self, averages_df: pd.DataFrame) -> Dict:
        """
        Calculate league-wide averages for all statistical categories
        Args:
            averages_df: DataFrame with per-game averages
        Returns:
            Dictionary with league averages
        """
        league_stats = {}
        
        for category in RANKING_CATEGORIES + ['GP']:
            if category in averages_df.columns:
                league_stats[category] = float(averages_df[category].mean())
        
        return league_stats
    
    def normalize_for_heatmap(self, averages_df: pd.DataFrame) -> List[List[float]]:
        """
        Normalize data for heatmap visualization
        Args:
            averages_df: DataFrame with per-game averages
        Returns:
            Normalized data matrix for heatmap
        """
        normalized_data = []
        
        for category in RANKING_CATEGORIES:
            if category in averages_df.columns:
                col_data = averages_df[category]
                min_val, max_val = col_data.min(), col_data.max()
                
                # Normalize to 0-1 range
                if max_val - min_val > 0:
                    normalized_col = ((col_data - min_val) / (max_val - min_val)).tolist()
                else:
                    # If all values are the same, set to 0.5
                    normalized_col = [0.5] * len(col_data)
                
                normalized_data.append(normalized_col)
        
        # Transpose so each row represents a team
        return list(map(list, zip(*normalized_data)))
    
    def get_team_stats(self, team_name: str, totals_df: pd.DataFrame, 
                      averages_df: pd.DataFrame, rankings_df: pd.DataFrame) -> Dict:
        """
        Get comprehensive stats for a specific team
        Args:
            team_name: Name of the team
            totals_df: DataFrame with total stats
            averages_df: DataFrame with averages
            rankings_df: DataFrame with rankings
        Returns:
            Dictionary with all team statistics
        """
        if team_name not in totals_df.index:
            raise ValueError(f"Team '{team_name}' not found")
        
        # Get data for this team
        totals_data = totals_df.loc[team_name]
        avg_data = averages_df.loc[team_name]
        rank_data = rankings_df[rankings_df['Team'] == team_name].iloc[0]
        
        return {
            'team': team_name,
            'totals': totals_data.to_dict(),
            'averages': avg_data.to_dict(),
            'rankings': {col: int(rank_data[col]) for col in RANKING_CATEGORIES if col in rank_data},
            'total_points': float(rank_data['Total_Points']),
            'overall_rank': int(rank_data['Rank'])
        }
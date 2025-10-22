import pandas as pd
from typing import Dict, List
from app.utils.constants import RANKING_CATEGORIES


class StatsCalculator:
    """Pure statistical calculations and derived metrics"""
    
    def calculate_rankings(self, averages_df: pd.DataFrame) -> pd.DataFrame:
        """
        Calculate rankings from averages DataFrame
        Args:
            averages_df: DataFrame with per-game averages
        Returns:
            DataFrame with rankings and total points
        """
        if averages_df.empty:
            raise ValueError("Cannot calculate rankings for empty DataFrame")
        
        ranked = averages_df.copy()

        # Keep team_id, team_name, and GP for reference
        ranking_cols = [col for col in ranked.columns if col not in ['team_id', 'team_name', 'GP']]
        team_info = ranked[['team_id', 'team_name', 'GP']].copy()

        # Calculate rankings only for statistical categories
        ranked_stats = ranked[ranking_cols].rank()
        
        # Add total points
        ranked_stats['TOTAL_POINTS'] = ranked_stats.sum(axis=1)
        
        # Sort by total points
        ranked_stats.sort_values(by='TOTAL_POINTS', ascending=False, inplace=True)
        
        # Add rank column
        ranked_stats['RANK'] = ranked_stats['TOTAL_POINTS'].rank(method='min', ascending=False).astype(int)
        
        # Reset index and merge with team info
        ranked_stats.reset_index(inplace=True)
        final_ranked = pd.merge(ranked_stats, team_info, left_on='index', right_index=True, how='left')
        final_ranked.drop('index', axis=1, inplace=True)
        
        # Reorder columns to have team info first
        cols = ['team_id', 'team_name', 'GP'] + [col for col in final_ranked.columns if col not in ['team_id', 'team_name', 'GP']]
        final_ranked = final_ranked[cols]

        return final_ranked
    
    def find_category_leaders(self, averages_df: pd.DataFrame) -> Dict:
        """
        Find the leader in each statistical category
        Args:
            averages_df: DataFrame with per-game averages
        Returns:
            Dictionary with category leaders
        """
        if averages_df.empty:
            return {}
        
        leaders = {}
        
        for category in RANKING_CATEGORIES:
            if category in averages_df.columns:
                if averages_df[category].isnull().all():
                    continue

                # Find team with highest value in this category
                best_team_idx = averages_df[category].idxmax()
                best_team_row = averages_df.iloc[best_team_idx]
                best_value = best_team_row[category]
                
                leaders[f'{category}_leader'] = {
                    'team_id': int(best_team_row['team_id']),
                    'team_name': str(best_team_row['team_name']),
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
        if averages_df.empty:
            return {}
        
        league_stats = {}
        
        for category in RANKING_CATEGORIES + ['GP']:
            if category in averages_df.columns:
                league_stats[category] = float(averages_df[category].mean())
        
        return league_stats
    
    def normalize_for_heatmap(self, averages_df: pd.DataFrame) -> List[List[float]]:
        """
        Normalize data for heatmap visualization using diverging scale
        centered on the league average (average = 0.5 = white)
        Args:
            averages_df: DataFrame with per-game averages
        Returns:
            Normalized data matrix for heatmap
        """
        if averages_df.empty:
            return []

        normalized_data = []
        categories_with_gp = RANKING_CATEGORIES + ['GP']

        for category in categories_with_gp:
            if category in averages_df.columns:
                col_data = averages_df[category]
                mean_val = col_data.mean()
                min_val, max_val = col_data.min(), col_data.max()

                if max_val - min_val > 0:
                    normalized_col = []
                    for val in col_data:
                        if val < mean_val:
                            if mean_val - min_val > 0:
                                norm_val = 0.5 * (val - min_val) / (mean_val - min_val)
                            else:
                                norm_val = 0.5
                        else:
                            if max_val - mean_val > 0:
                                norm_val = 0.5 + 0.5 * (val - mean_val) / (max_val - mean_val)
                            else:
                                norm_val = 0.5
                        normalized_col.append(norm_val)
                else:
                    normalized_col = [0.5] * len(col_data)

                normalized_data.append(normalized_col)

        return list(map(list, zip(*normalized_data)))
    
    def calculate_per_game_averages(self, totals_df: pd.DataFrame) -> pd.DataFrame:
        """
        Calculate per-game averages from totals DataFrame
        Args:
            totals_df: DataFrame with total stats
        Returns:
            DataFrame with per-game averages
        """
        if totals_df.empty:
            raise ValueError("Cannot calculate averages for empty DataFrame")
        
        from app.utils.constants import PER_GAME_CATEGORIES
        
        # Create copy without raw counting stats (keep percentages)
        averages = totals_df.drop(['FGM', 'FGA', 'FTM', 'FTA'], axis=1).copy()
        # Calculate per-game averages for counting stats
        averages[PER_GAME_CATEGORIES] = averages[PER_GAME_CATEGORIES].div(averages['GP'], axis=0).fillna(0)
        return averages
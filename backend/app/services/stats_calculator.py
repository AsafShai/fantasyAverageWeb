import pandas as pd
from typing import Dict, List, Optional
from app.utils.constants import RANKING_CATEGORIES, DERIVED_CATEGORIES
from app.utils.espn_stat_map import NON_RANKING_STAT_KEYS


class StatsCalculator:
    """Pure statistical calculations and derived metrics"""
    
    def calculate_rankings(self, averages_df: pd.DataFrame, reverse_categories: Optional[set] = None) -> pd.DataFrame:
        """
        Calculate rankings from averages DataFrame
        Args:
            averages_df: DataFrame with per-game averages
            reverse_categories: category codes where a lower raw value scores
                                 better (e.g. turnovers) — that column is ranked
                                 with the worst raw value getting the lowest score,
                                 instead of the default "higher raw value wins"
        Returns:
            DataFrame with rankings and total points
        """
        if averages_df.empty:
            raise ValueError("Cannot calculate rankings for empty DataFrame")

        ranked = averages_df.copy()
        reverse_categories = reverse_categories or set()

        # Keep team_id, team_name, and GP for reference
        ranking_cols = [col for col in ranked.columns if col not in ['team_id', 'team_name', 'GP']]
        team_info = ranked[['team_id', 'team_name', 'GP']].copy()

        # Calculate rankings only for statistical categories. Each column's
        # score increases with "better" performance in that category: for a
        # normal category that means the highest raw value scores highest
        # (ascending=True); for a reverse category (e.g. turnovers) the lowest
        # raw value should score highest, so that column ranks ascending=False.
        ranked_stats = pd.DataFrame(index=ranked.index)
        for col in ranking_cols:
            ranked_stats[col] = ranked[col].rank(ascending=col not in reverse_categories)

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
    
    def find_category_leaders(self, averages_df: pd.DataFrame, categories: Optional[List[str]] = None,
                            reverse_categories: Optional[set] = None) -> Dict:
        """
        Find the leader in each statistical category
        Args:
            averages_df: DataFrame with per-game averages
            categories: category codes to report leaders for (defaults to RANKING_CATEGORIES)
            reverse_categories: category codes where the lowest raw value is the
                                 leader (e.g. turnovers), instead of the highest
        Returns:
            Dictionary with category leaders
        """
        if averages_df.empty:
            return {}

        leaders = {}
        reverse_categories = reverse_categories or set()

        for category in (categories or RANKING_CATEGORIES):
            if category in averages_df.columns:
                if averages_df[category].isnull().all():
                    continue

                # Find the best-performing team in this category: highest raw
                # value, unless it's a reverse category (e.g. turnovers) where
                # the lowest raw value is the leader.
                best_team_idx = (
                    averages_df[category].idxmin() if category in reverse_categories
                    else averages_df[category].idxmax()
                )
                best_team_row = averages_df.iloc[best_team_idx]
                best_value = best_team_row[category]
                
                leaders[f'{category}_leader'] = {
                    'team_id': int(best_team_row['team_id']),
                    'team_name': str(best_team_row['team_name']),
                    'value': float(best_value)
                }
        
        return leaders
    
    def calculate_league_averages(self, averages_df: pd.DataFrame, categories: Optional[List[str]] = None) -> Dict:
        """
        Calculate league-wide averages for all statistical categories
        Args:
            averages_df: DataFrame with per-game averages
            categories: category codes to average (defaults to RANKING_CATEGORIES)
        Returns:
            Dictionary with league averages
        """
        if averages_df.empty:
            return {}

        league_stats = {}

        for category in (categories or RANKING_CATEGORIES) + ['GP']:
            if category in averages_df.columns:
                league_stats[category] = float(averages_df[category].mean())

        return league_stats

    def normalize_for_heatmap(self, averages_df: pd.DataFrame, categories: Optional[List[str]] = None,
                            reverse_categories: Optional[set] = None) -> List[List[float]]:
        """
        Normalize data for heatmap visualization using diverging scale
        centered on the league average (average = 0.5 = white)
        Args:
            averages_df: DataFrame with per-game averages
            categories: category codes to include (defaults to RANKING_CATEGORIES)
            reverse_categories: category codes where a lower raw value is better
                                 (e.g. turnovers) — colored inverted so "better"
                                 always reads as the same end of the scale
        Returns:
            Normalized data matrix for heatmap
        """
        if averages_df.empty:
            return []

        normalized_data = []
        categories_with_gp = (categories or RANKING_CATEGORIES) + ['GP']
        reverse_categories = reverse_categories or set()

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
                        if category in reverse_categories:
                            norm_val = 1.0 - norm_val
                        normalized_col.append(norm_val)
                else:
                    normalized_col = [0.5] * len(col_data)

                normalized_data.append(normalized_col)

        return list(map(list, zip(*normalized_data)))
    
    def calculate_per_game_averages(self, totals_df: pd.DataFrame, categories: Optional[List[str]] = None) -> pd.DataFrame:
        """
        Calculate per-game averages from totals DataFrame
        Args:
            totals_df: DataFrame with total stats
            categories: category codes to average (defaults to RANKING_CATEGORIES).
                        Derived categories (FG%, PPG, A/TO, ...) are already
                        rates and are left as-is; every other category present
                        is divided by GP.
        Returns:
            DataFrame with per-game averages
        """
        if totals_df.empty:
            raise ValueError("Cannot calculate averages for empty DataFrame")

        per_game_categories = [
            c for c in (categories or RANKING_CATEGORIES)
            if c not in DERIVED_CATEGORIES
        ]

        # Drop the raw quantities that only exist to build derived categories.
        # GP is exempt: it is the divisor below and callers read it downstream.
        feeder_cols = [c for c in NON_RANKING_STAT_KEYS if c != 'GP']
        averages = totals_df.drop(feeder_cols, axis=1, errors='ignore').copy()
        per_game_categories = [c for c in per_game_categories if c in averages.columns]
        # Calculate per-game averages for counting stats
        averages[per_game_categories] = averages[per_game_categories].div(averages['GP'], axis=0).fillna(0)
        return averages
from typing import Dict, List, Optional

import numpy as np
import polars as pl

from app.utils import pdcompat
from app.utils.constants import RANKING_CATEGORIES, DERIVED_CATEGORIES
from app.utils.espn_stat_map import NON_RANKING_STAT_KEYS


class StatsCalculator:
    """Pure statistical calculations and derived metrics"""
    
    def calculate_rankings(self, averages_df: pl.DataFrame, reverse_categories: Optional[set] = None) -> pl.DataFrame:
        """
        Calculate rankings from averages DataFrame
        Args:
            averages_df: DataFrame with per-game averages
            reverse_categories: category codes where a lower raw value scores
                                 better (e.g. turnovers) — that column is ranked
                                 with the worst raw value getting the lowest score,
                                 instead of the default "higher raw value wins"
        Returns:
            DataFrame with rankings and total points: team_id, team_name, GP,
            one rank column per category, TOTAL_POINTS, RANK — sorted by
            TOTAL_POINTS descending (ties keep the input order).
        """
        if averages_df.is_empty():
            raise ValueError("Cannot calculate rankings for empty DataFrame")

        reverse_categories = reverse_categories or set()

        # Calculate rankings only for statistical categories. Each column's
        # score increases with "better" performance in that category: for a
        # normal category that means the highest raw value scores highest
        # (ascending=True); for a reverse category (e.g. turnovers) the lowest
        # raw value should score highest, so that column ranks ascending=False.
        ranking_cols = [col for col in averages_df.columns if col not in ['team_id', 'team_name', 'GP']]
        ranked = {
            col: pdcompat.rank(averages_df[col], ascending=col not in reverse_categories)
            for col in ranking_cols
        }
        # Ranks are multiples of 0.5, so their sum is exact in any order.
        total = np.zeros(averages_df.height)
        for col in ranking_cols:
            total = total + np.where(np.isnan(ranked[col]), 0.0, ranked[col])

        order = pdcompat.argsort(total, ascending=False)
        rank = pdcompat.rank(total, method='min', ascending=False).astype(int)
        out = averages_df.select('team_id', 'team_name', 'GP')[order]
        return out.with_columns(
            *[pl.Series(col, ranked[col][order], dtype=pl.Float64) for col in ranking_cols],
            pl.Series('TOTAL_POINTS', total[order], dtype=pl.Float64),
            pl.Series('RANK', rank[order], dtype=pl.Int64),
        )

    def find_category_leaders(self, averages_df: pl.DataFrame, categories: Optional[List[str]] = None,
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
        if averages_df.is_empty():
            return {}

        leaders = {}
        reverse_categories = reverse_categories or set()

        for category in (categories or RANKING_CATEGORIES):
            if category in averages_df.columns:
                values = pdcompat.as_float(averages_df[category])
                if np.isnan(values).all():
                    continue

                # Find the best-performing team in this category: highest raw
                # value, unless it's a reverse category (e.g. turnovers) where
                # the lowest raw value is the leader (first one on a tie).
                best = (
                    pdcompat.nanargmin(values) if category in reverse_categories
                    else pdcompat.nanargmax(values)
                )
                best_team_row = averages_df.row(best, named=True)
                leaders[f'{category}_leader'] = {
                    'team_id': int(best_team_row['team_id']),
                    'team_name': str(best_team_row['team_name']),
                    'value': float(values[best])
                }

        return leaders

    def calculate_league_averages(self, averages_df: pl.DataFrame, categories: Optional[List[str]] = None) -> Dict:
        """
        Calculate league-wide averages for all statistical categories
        Args:
            averages_df: DataFrame with per-game averages
            categories: category codes to average (defaults to RANKING_CATEGORIES)
        Returns:
            Dictionary with league averages
        """
        if averages_df.is_empty():
            return {}

        league_stats = {}

        for category in (categories or RANKING_CATEGORIES) + ['GP']:
            if category in averages_df.columns:
                league_stats[category] = float(pdcompat.nanmean(averages_df[category]))

        return league_stats

    def normalize_for_heatmap(self, averages_df: pl.DataFrame, categories: Optional[List[str]] = None,
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
        if averages_df.is_empty():
            return []

        normalized_data = []
        categories_with_gp = (categories or RANKING_CATEGORIES) + ['GP']
        reverse_categories = reverse_categories or set()

        for category in categories_with_gp:
            if category in averages_df.columns:
                col_data = pdcompat.as_float(averages_df[category]).tolist()   # nulls as NaN, as pandas gave
                mean_val = pdcompat.nanmean(averages_df[category])
                min_val, max_val = pdcompat.nanmin(averages_df[category]), pdcompat.nanmax(averages_df[category])

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

    def calculate_per_game_averages(self, totals_df: pl.DataFrame, categories: Optional[List[str]] = None) -> pl.DataFrame:
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
        if totals_df.is_empty():
            raise ValueError("Cannot calculate averages for empty DataFrame")

        per_game_categories = [
            c for c in (categories or RANKING_CATEGORIES)
            if c not in DERIVED_CATEGORIES
        ]

        # Drop the raw quantities that only exist to build derived categories.
        # GP is exempt: it is the divisor below and callers read it downstream.
        feeder_cols = [c for c in NON_RANKING_STAT_KEYS if c != 'GP']
        averages = totals_df.drop([c for c in feeder_cols if c in totals_df.columns])
        per_game_categories = [c for c in per_game_categories if c in averages.columns]
        # Per-game averages for counting stats; 0/0 (no games) reads as 0, as
        # pandas' fillna(0) did (x/0 stays inf, as it did there).
        gp = averages['GP'].cast(pl.Float64)
        return averages.with_columns([
            (pl.col(c).cast(pl.Float64) / gp).fill_nan(0.0).fill_null(0.0).alias(c)
            for c in per_game_categories
        ])

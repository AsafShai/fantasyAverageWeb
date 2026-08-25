import logging
import pandas as pd
from datetime import date
from typing import Optional
from app.models import LeagueRankings
from app.exceptions import InvalidParameterError, ResourceNotFoundError
from app.services.data_provider import DataProvider
from app.builders.response_builder import ResponseBuilder
from app.utils.constants import RANKING_CATEGORIES, PER_GAME_CATEGORIES, DERIVED_CATEGORIES, RATIO_CATEGORIES
from app.config import settings

class RankingService:
    """Service for ranking-related operations"""

    def __init__(self):
        self.data_provider = DataProvider()
        self.response_builder = ResponseBuilder()
        self.logger = logging.getLogger(__name__)

    async def get_league_rankings(self, sort_by: Optional[str] = None, order: str = "asc",
                                   start_date: Optional[date] = None,
                                   end_date: Optional[date] = None) -> LeagueRankings:
        """Get league rankings. If dates provided, compute from DB snapshot deltas."""
        if start_date is not None and end_date is not None:
            return await self._get_rankings_for_range(start_date, end_date, sort_by, order)

        totals_df, averages_df, averages_rankings_df = await self.data_provider.get_all_dataframes()
        if totals_df is None:
            raise ResourceNotFoundError("Unable to fetch rankings data from ESPN API")

        categories = await self.data_provider.get_ranking_categories()
        reverse_categories = await self.data_provider.get_reverse_categories()
        totals_raw_df, totals_rankings_df = self._build_totals_rankings_df(totals_df, categories, reverse_categories)

        if sort_by is not None and not self._is_valid_sort_column(sort_by, averages_rankings_df):
            raise InvalidParameterError(f"Invalid sort column: {sort_by}")
        if order not in ["asc", "desc"]:
            raise InvalidParameterError("Order must be 'asc' or 'desc'")

        return self.response_builder.build_rankings_response(
            averages_df=averages_df,
            totals_df=totals_raw_df,
            averages_rankings_df=averages_rankings_df,
            totals_rankings_df=totals_rankings_df,
            sort_by=sort_by,
            order=order,
            data_date=self.data_provider.get_data_date(),
            categories=categories,
        )

    async def _get_rankings_for_range(self, start_date: date, end_date: date,
                                       sort_by: Optional[str], order: str) -> LeagueRankings:
        actual_end_date, actual_start_date, rows_end, rows_start = \
            await self.data_provider.db_service.get_snapshots_for_date_range(
                start_date, end_date, settings.league_id, settings.season_id
            )

        if actual_end_date is None or not rows_end:
            raise ResourceNotFoundError("No data available for the requested date range")

        end_df = pd.DataFrame(rows_end)
        start_df = pd.DataFrame(rows_start) if rows_start else None

        categories = await self.data_provider.get_ranking_categories()
        reverse_categories = await self.data_provider.get_reverse_categories()

        delta_df = self._compute_delta(end_df, start_df)

        averages_df, averages_rankings_df = self._build_averages_rankings_df(
            delta_df, categories, reverse_categories
        )
        totals_raw_df, totals_rankings_df = self._build_totals_rankings_df_from_delta(
            delta_df, categories, reverse_categories
        )

        if sort_by is not None and not self._is_valid_sort_column(sort_by, averages_rankings_df):
            raise InvalidParameterError(f"Invalid sort column: {sort_by}")
        if order not in ["asc", "desc"]:
            raise InvalidParameterError("Order must be 'asc' or 'desc'")

        return self.response_builder.build_rankings_response(
            averages_df=averages_df,
            totals_df=totals_raw_df,
            averages_rankings_df=averages_rankings_df,
            totals_rankings_df=totals_rankings_df,
            sort_by=sort_by,
            order=order,
            date_range_start=start_date,
            date_range_end=end_date,
            actual_start_date=actual_start_date,
            actual_end_date=actual_end_date,
            categories=categories,
        )

    def _compute_delta(self, end_df: pd.DataFrame, start_df: Optional[pd.DataFrame]) -> pd.DataFrame:
        """Compute per-team delta between end and start snapshots.

        Both frames are keyed by category code and carry whatever categories the
        league scores, so the counting columns are read off the frame rather than
        listed here. A ratio category cannot be differenced -- the delta of two
        cumulative percentages is meaningless -- so it is rebuilt from its
        made/attempted sources after they have been differenced."""
        id_cols = ['team_id', 'team_name']
        counting_cols = [c for c in end_df.columns
                         if c not in id_cols and c not in DERIVED_CATEGORIES]

        if start_df is None or start_df.empty:
            delta = end_df[id_cols + counting_cols].copy()
        else:
            shared = [c for c in counting_cols if c in start_df.columns]
            merged = end_df.merge(start_df[['team_id'] + shared], on='team_id', suffixes=('_end', '_start'))
            delta = pd.DataFrame()
            delta['team_id'] = merged['team_id']
            delta['team_name'] = end_df.set_index('team_id').loc[merged['team_id'].values, 'team_name'].values
            for col in counting_cols:
                if col in shared:
                    delta[col] = merged[f'{col}_end'] - merged[f'{col}_start']
                else:
                    delta[col] = merged[col]

        for category, (numerator, denominator) in RATIO_CATEGORIES.items():
            if category not in end_df.columns:
                continue
            if numerator in delta.columns and denominator in delta.columns:
                delta[category] = (delta[numerator] / delta[denominator].replace(0, float('nan'))).fillna(0)
        return delta

    def _delta_categories_df(self, delta_df: pd.DataFrame, categories: list[str]) -> pd.DataFrame:
        """delta_df narrowed to the league's scoring categories plus team info.

        Drops the made/attempted feeders and anything else the delta carries that
        is not itself scored, so nothing unscored reaches calculate_rankings and
        gets ranked as if it were a category."""
        cols = ['team_id', 'team_name', 'GP'] + [c for c in categories if c in delta_df.columns]
        return delta_df[[c for c in cols if c in delta_df.columns]].copy()

    def _build_averages_rankings_df(self, delta_df: pd.DataFrame,
                                     categories: Optional[list[str]] = None,
                                     reverse_categories: Optional[set] = None) -> tuple[pd.DataFrame, pd.DataFrame]:
        """Build (raw averages, rankings) DataFrames from delta (divide counting stats by GP)."""
        from app.services.data_transformer import DataTransformer
        transformer = DataTransformer()

        categories = categories or RANKING_CATEGORIES
        df = self._delta_categories_df(delta_df, categories)
        averages_df = transformer.totals_to_averages_df(df, categories)
        return averages_df, transformer.averages_to_rankings_df(averages_df, reverse_categories)

    def _build_totals_rankings_df_from_delta(self, delta_df: pd.DataFrame,
                                              categories: Optional[list[str]] = None,
                                              reverse_categories: Optional[set] = None) -> tuple[pd.DataFrame, pd.DataFrame]:
        """Build (raw totals, rankings) DataFrames directly from delta counting stats."""
        from app.services.data_transformer import DataTransformer
        transformer = DataTransformer()

        categories = categories or RANKING_CATEGORIES
        df = self._delta_categories_df(delta_df, categories)
        return df, transformer.averages_to_rankings_df(df, reverse_categories)

    def _build_totals_rankings_df(self, totals_df: pd.DataFrame,
                                   categories: Optional[list[str]] = None,
                                   reverse_categories: Optional[set] = None) -> tuple[pd.DataFrame, pd.DataFrame]:
        """Build (raw totals, rankings) DataFrames from season totals (no per-game division).
        categories defaults to RANKING_CATEGORIES."""
        from app.services.data_transformer import DataTransformer
        transformer = DataTransformer()

        categories = categories or RANKING_CATEGORIES
        cols_to_keep = ['team_id', 'team_name', 'GP'] + [c for c in categories if c in totals_df.columns]
        df = totals_df[[c for c in cols_to_keep if c in totals_df.columns]].copy()
        return df, transformer.averages_to_rankings_df(df, reverse_categories)

    def _is_valid_sort_column(self, sort_by: str, rankings_df) -> bool:
        return sort_by.upper() in rankings_df.columns

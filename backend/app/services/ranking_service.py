import logging
import pandas as pd
from datetime import date
from typing import Optional
from app.models import LeagueRankings
from app.exceptions import InvalidParameterError, ResourceNotFoundError
from app.services.data_provider import DataProvider
from app.builders.response_builder import ResponseBuilder
from app.utils.constants import RANKING_CATEGORIES, PER_GAME_CATEGORIES

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

        totals_df = await self.data_provider.get_totals_df()
        if totals_df is None:
            raise ResourceNotFoundError("Unable to fetch rankings data from ESPN API")

        averages_rankings_df = await self.data_provider.get_rankings_df()
        totals_rankings_df = self._build_totals_rankings_df(totals_df)

        if sort_by is not None and not self._is_valid_sort_column(sort_by, averages_rankings_df):
            raise InvalidParameterError(f"Invalid sort column: {sort_by}")
        if order not in ["asc", "desc"]:
            raise InvalidParameterError("Order must be 'asc' or 'desc'")

        return self.response_builder.build_rankings_response(
            averages_rankings_df=averages_rankings_df,
            totals_rankings_df=totals_rankings_df,
            sort_by=sort_by,
            order=order,
            data_date=self.data_provider.get_data_date(),
        )

    async def _get_rankings_for_range(self, start_date: date, end_date: date,
                                       sort_by: Optional[str], order: str) -> LeagueRankings:
        actual_end_date, actual_start_date, rows_end, rows_start = \
            await self.data_provider.db_service.get_snapshots_for_date_range(start_date, end_date)

        if actual_end_date is None or not rows_end:
            raise ResourceNotFoundError("No data available for the requested date range")

        end_df = pd.DataFrame(rows_end)
        start_df = pd.DataFrame(rows_start) if rows_start else None

        delta_df = self._compute_delta(end_df, start_df)

        averages_rankings_df = self._build_averages_rankings_df(delta_df)
        totals_rankings_df = self._build_totals_rankings_df_from_delta(delta_df)

        if sort_by is not None and not self._is_valid_sort_column(sort_by, averages_rankings_df):
            raise InvalidParameterError(f"Invalid sort column: {sort_by}")
        if order not in ["asc", "desc"]:
            raise InvalidParameterError("Order must be 'asc' or 'desc'")

        return self.response_builder.build_rankings_response(
            averages_rankings_df=averages_rankings_df,
            totals_rankings_df=totals_rankings_df,
            sort_by=sort_by,
            order=order,
            date_range_start=start_date,
            date_range_end=end_date,
            actual_start_date=actual_start_date,
            actual_end_date=actual_end_date,
        )

    def _compute_delta(self, end_df: pd.DataFrame, start_df: Optional[pd.DataFrame]) -> pd.DataFrame:
        """Compute per-team delta between end and start snapshots."""
        counting_cols = ['gp', 'fgm', 'fga', 'ftm', 'fta', 'three_pm', 'reb', 'ast', 'stl', 'blk', 'pts']

        if start_df is None or start_df.empty:
            delta = end_df[['team_id', 'team_name'] + counting_cols].copy()
        else:
            merged = end_df.merge(start_df[['team_id'] + counting_cols], on='team_id', suffixes=('_end', '_start'))
            delta = pd.DataFrame()
            delta['team_id'] = merged['team_id']
            delta['team_name'] = end_df.set_index('team_id').loc[merged['team_id'].values, 'team_name'].values
            for col in counting_cols:
                delta[col] = merged[f'{col}_end'] - merged[f'{col}_start']

        delta['fg_pct'] = (delta['fgm'] / delta['fga'].replace(0, float('nan'))).fillna(0)
        delta['ft_pct'] = (delta['ftm'] / delta['fta'].replace(0, float('nan'))).fillna(0)
        return delta

    def _build_averages_rankings_df(self, delta_df: pd.DataFrame) -> pd.DataFrame:
        """Build averages rankings DataFrame from delta (divide counting stats by GP)."""
        from app.services.data_transformer import DataTransformer
        transformer = DataTransformer()

        df = pd.DataFrame()
        df['team_id'] = delta_df['team_id']
        df['team_name'] = delta_df['team_name']
        df['GP'] = delta_df['gp']
        df['FGM'] = delta_df['fgm']
        df['FGA'] = delta_df['fga']
        df['FTM'] = delta_df['ftm']
        df['FTA'] = delta_df['fta']
        df['FG%'] = delta_df['fg_pct']
        df['FT%'] = delta_df['ft_pct']
        df['3PM'] = delta_df['three_pm']
        df['REB'] = delta_df['reb']
        df['AST'] = delta_df['ast']
        df['STL'] = delta_df['stl']
        df['BLK'] = delta_df['blk']
        df['PTS'] = delta_df['pts']

        averages_df = transformer.totals_to_averages_df(df)
        return transformer.averages_to_rankings_df(averages_df)

    def _build_totals_rankings_df_from_delta(self, delta_df: pd.DataFrame) -> pd.DataFrame:
        """Build totals rankings DataFrame directly from delta counting stats."""
        from app.services.data_transformer import DataTransformer
        transformer = DataTransformer()

        df = pd.DataFrame()
        df['team_id'] = delta_df['team_id']
        df['team_name'] = delta_df['team_name']
        df['GP'] = delta_df['gp']
        df['FG%'] = delta_df['fg_pct']
        df['FT%'] = delta_df['ft_pct']
        df['3PM'] = delta_df['three_pm']
        df['REB'] = delta_df['reb']
        df['AST'] = delta_df['ast']
        df['STL'] = delta_df['stl']
        df['BLK'] = delta_df['blk']
        df['PTS'] = delta_df['pts']

        return transformer.averages_to_rankings_df(df)

    def _build_totals_rankings_df(self, totals_df: pd.DataFrame) -> pd.DataFrame:
        """Build totals rankings DataFrame from season totals (no per-game division)."""
        from app.services.data_transformer import DataTransformer
        transformer = DataTransformer()

        cols_to_keep = ['team_id', 'team_name', 'GP'] + [c for c in RANKING_CATEGORIES if c in totals_df.columns]
        df = totals_df[[c for c in cols_to_keep if c in totals_df.columns]].copy()
        return transformer.averages_to_rankings_df(df)

    def _is_valid_sort_column(self, sort_by: str, rankings_df) -> bool:
        return sort_by.upper() in rankings_df.columns

import logging
import polars as pl
from datetime import date, timedelta
from typing import Optional
from app.models import LeagueRankings, with_live
from app.exceptions import InvalidParameterError, ResourceNotFoundError
from app.services.data_provider import DataProvider
from app.builders.response_builder import ResponseBuilder
from app.services import tonight_changes
from app.utils.constants import RANKING_CATEGORIES, PER_GAME_CATEGORIES, DERIVED_CATEGORIES, RATIO_CATEGORIES
from app.config import settings
from app.utils.frames import dicts_frame

class RankingService:
    """Service for ranking-related operations"""

    def __init__(self):
        self.data_provider = DataProvider()
        self.response_builder = ResponseBuilder()
        self.logger = logging.getLogger(__name__)

    async def get_league_rankings(self, sort_by: Optional[str] = None, order: str = "asc",
                                   start_date: Optional[date] = None,
                                   end_date: Optional[date] = None,
                                   settled: bool = False,
                                   played_only: bool = False) -> LeagueRankings:
        """Get league rankings. If dates provided, compute from DB snapshot deltas.

        ``settled`` keeps a date range on stored snapshots. The daily recap uses
        it so a live slate cannot replace the night the nightly job finished.

        ``played_only`` ranks a date range among the teams that played in it.
        The daily recap uses it so a team with no games that night neither
        takes last place nor hands the others a point each.
        """
        if start_date is not None and end_date is not None:
            return await self._get_rankings_for_range(start_date, end_date, sort_by, order,
                                                      settled=settled, played_only=played_only)
        # None while LIVE_STANDINGS_ENABLED is off: the response is then built
        # exactly as before and carries no ``live`` block. The block is attached
        # after the memo because it changes with the clock, not with the frames.
        live_state = await self.data_provider.get_live_state(include_finals=True)
        if live_state is None:
            return await self.data_provider.memo_response(
                'rankings', (sort_by, order), lambda: self._get_season_rankings(sort_by, order)
            )
        response = await self.data_provider.memo_response(
            'rankings', (sort_by, order), lambda: self._get_season_rankings(sort_by, order, live=True), live=True
        )
        return with_live(response, live_state)

    async def _get_season_rankings(self, sort_by: Optional[str], order: str, live: bool = False) -> LeagueRankings:
        if live:
            totals_df, averages_df, averages_rankings_df = await self.data_provider.get_all_dataframes(live=True)
        else:
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

    async def range_deltas(self, start_date: date, end_date: date, settled: bool = False):
        """What a date range covers: (actual_start, actual_end, settled delta,
        in-progress delta, live state).

        A range that ends today (plan section 7 step 4) takes the live frames
        as its end instead of the latest stored snapshot: ESPN's season totals
        through last night plus tonight, finished games only for averages and
        every started game for totals. The state is None unless the range
        reaches tonight with LIVE_STANDINGS_ENABLED on; otherwise the range is
        exactly as before.

        ``settled`` (the daily recap: the night the nightly job finished, never
        a slate in progress) ends at the range's last night. When the stored
        snapshots don't hold that night yet, it is taken from the live frames
        if they are that night with every game final (ESPN hasn't rolled the
        period over yet: tonight_changes.is_finished_night); otherwise the
        snapshot is synced first, for the minutes after ESPN's rollover before
        anything wrote it. Failing both it is the stored days, as before."""
        snapshots = self.data_provider.db_service.get_snapshots_for_date_range
        actual_end_date, actual_start_date, rows_end, rows_start = \
            await snapshots(start_date, end_date, settings.league_id, settings.season_id)

        if actual_end_date is None or not rows_end:
            raise ResourceNotFoundError("No data available for the requested date range")

        state = None
        if not settled:
            state = await self.data_provider.get_live_state(include_finals=True)
            if not tonight_changes.range_reaches_tonight(state, end_date):
                state = None
        elif actual_end_date < (night := end_date - timedelta(days=1)):
            state = await self.data_provider.get_live_state(include_finals=True)
            if not tonight_changes.is_finished_night(state, night):
                state = None
                if await self.data_provider.sync_db_now():
                    actual_end_date, actual_start_date, rows_end, rows_start = \
                        await snapshots(start_date, end_date, settings.league_id, settings.season_id)
                    if actual_end_date is None or not rows_end:
                        raise ResourceNotFoundError("No data available for the requested date range")

        start_df = dicts_frame(rows_start) if rows_start else None
        if state is not None and state.active:
            try:
                settled_frame = tonight_changes.as_snapshot(await self.data_provider.get_totals_df(live=True, settled=True))
                progress = tonight_changes.as_snapshot(await self.data_provider.get_totals_df(live=True))
                return (actual_start_date, tonight_changes.slate_date(state.period),
                        self._compute_delta(settled_frame, start_df), self._compute_delta(progress, start_df), state)
            except Exception as e:
                self.logger.error(f"Live range end failed, serving stored days: {type(e).__name__}: {e}", exc_info=True)
                state = None
        delta_df = self._compute_delta(dicts_frame(rows_end), start_df)
        return actual_start_date, actual_end_date, delta_df, delta_df, state

    async def _get_rankings_for_range(self, start_date: date, end_date: date,
                                       sort_by: Optional[str], order: str,
                                       settled: bool = False,
                                       played_only: bool = False) -> LeagueRankings:
        actual_start_date, actual_end_date, settled_delta, progress_delta, live_state = \
            await self.range_deltas(start_date, end_date, settled=settled)
        league_team_count = settled_delta.height
        if played_only:
            settled_delta = self._played(settled_delta)
            progress_delta = self._played(progress_delta)

        categories = await self.data_provider.get_ranking_categories()
        reverse_categories = await self.data_provider.get_reverse_categories()

        averages_df, averages_rankings_df = self._build_averages_rankings_df(
            settled_delta, categories, reverse_categories
        )
        totals_raw_df, totals_rankings_df = self._build_totals_rankings_df_from_delta(
            progress_delta, categories, reverse_categories
        )

        if sort_by is not None and not self._is_valid_sort_column(sort_by, averages_rankings_df):
            raise InvalidParameterError(f"Invalid sort column: {sort_by}")
        if order not in ["asc", "desc"]:
            raise InvalidParameterError("Order must be 'asc' or 'desc'")

        response = self.response_builder.build_rankings_response(
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
        response.league_team_count = league_team_count
        return with_live(response, live_state)

    @staticmethod
    def _played(delta_df: pl.DataFrame) -> pl.DataFrame:
        """The teams with at least one game in the range."""
        if 'GP' not in delta_df.columns:
            return delta_df
        return delta_df.filter(pl.col('GP') > 0)

    def _compute_delta(self, end_df: pl.DataFrame, start_df: Optional[pl.DataFrame]) -> pl.DataFrame:
        """Compute per-team delta between end and start snapshots.

        Both frames are keyed by category code and carry whatever categories the
        league scores, so the counting columns are read off the frame rather than
        listed here. A ratio category cannot be differenced -- the delta of two
        cumulative percentages is meaningless -- so it is rebuilt from its
        made/attempted sources after they have been differenced."""
        id_cols = ['team_id', 'team_name']
        counting_cols = [c for c in end_df.columns
                         if c not in id_cols and c not in DERIVED_CATEGORIES]

        if start_df is None or start_df.is_empty():
            delta = end_df.select(id_cols + counting_cols)
        else:
            shared = [c for c in counting_cols if c in start_df.columns]
            start = start_df.select(['team_id'] + shared).rename({c: f'{c}__start' for c in shared})
            merged = end_df.join(start, on='team_id', how='inner', maintain_order='left')
            delta = merged.select(
                'team_id', 'team_name',
                *[(pl.col(c) - pl.col(f'{c}__start')).alias(c) if c in shared else pl.col(c)
                  for c in counting_cols],
            )

        for category, (numerator, denominator) in RATIO_CATEGORIES.items():
            if category not in end_df.columns:
                continue
            if numerator in delta.columns and denominator in delta.columns:
                den = pl.col(denominator).cast(pl.Float64)
                delta = delta.with_columns(
                    (pl.col(numerator).cast(pl.Float64) / pl.when(den == 0).then(None).otherwise(den))
                    .fill_nan(0.0).fill_null(0.0).alias(category)
                )
        return delta

    def _delta_categories_df(self, delta_df: pl.DataFrame, categories: list[str]) -> pl.DataFrame:
        """delta_df narrowed to the league's scoring categories plus team info.

        Drops the made/attempted feeders and anything else the delta carries that
        is not itself scored, so nothing unscored reaches calculate_rankings and
        gets ranked as if it were a category."""
        cols = ['team_id', 'team_name', 'GP'] + [c for c in categories if c in delta_df.columns]
        return delta_df.select([c for c in cols if c in delta_df.columns])

    def _build_averages_rankings_df(self, delta_df: pl.DataFrame,
                                     categories: Optional[list[str]] = None,
                                     reverse_categories: Optional[set] = None) -> tuple[pl.DataFrame, pl.DataFrame]:
        """Build (raw averages, rankings) DataFrames from delta (divide counting stats by GP)."""
        from app.services.data_transformer import DataTransformer
        transformer = DataTransformer()

        categories = categories or RANKING_CATEGORIES
        df = self._delta_categories_df(delta_df, categories)
        averages_df = transformer.totals_to_averages_df(df, categories)
        return averages_df, transformer.averages_to_rankings_df(averages_df, reverse_categories)

    def _build_totals_rankings_df_from_delta(self, delta_df: pl.DataFrame,
                                              categories: Optional[list[str]] = None,
                                              reverse_categories: Optional[set] = None) -> tuple[pl.DataFrame, pl.DataFrame]:
        """Build (raw totals, rankings) DataFrames directly from delta counting stats."""
        from app.services.data_transformer import DataTransformer
        transformer = DataTransformer()

        categories = categories or RANKING_CATEGORIES
        df = self._delta_categories_df(delta_df, categories)
        return df, transformer.averages_to_rankings_df(df, reverse_categories)

    def _build_totals_rankings_df(self, totals_df: pl.DataFrame,
                                   categories: Optional[list[str]] = None,
                                   reverse_categories: Optional[set] = None) -> tuple[pl.DataFrame, pl.DataFrame]:
        """Build (raw totals, rankings) DataFrames from season totals (no per-game division).
        categories defaults to RANKING_CATEGORIES."""
        from app.services.data_transformer import DataTransformer
        transformer = DataTransformer()

        categories = categories or RANKING_CATEGORIES
        cols_to_keep = ['team_id', 'team_name', 'GP'] + [c for c in categories if c in totals_df.columns]
        df = totals_df.select([c for c in cols_to_keep if c in totals_df.columns])
        return df, transformer.averages_to_rankings_df(df, reverse_categories)

    def _is_valid_sort_column(self, sort_by: str, rankings_df) -> bool:
        return sort_by.upper() in rankings_df.columns

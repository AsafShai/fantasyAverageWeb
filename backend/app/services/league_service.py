import asyncio
import logging
import pandas as pd
from datetime import date
from typing import Dict, List, Optional
from app.models import LeagueSummary, HeatmapData, LeagueShotsData, AverageStats, RankingStats, with_live
from app.services.data_provider import DataProvider
from app.services.stats_calculator import StatsCalculator
from app.services.nba_stats_service import NBAStatsService
from app.services import tonight_changes
from app.builders.response_builder import ResponseBuilder
from app.exceptions import ResourceNotFoundError
from app.config import settings

class LeagueService:
    """Service for league-wide statistics and analytics operations"""
    
    def __init__(self):
        self.data_provider = DataProvider()
        self.stats_calculator = StatsCalculator()
        self.response_builder = ResponseBuilder()
        self.logger = logging.getLogger(__name__)
    
    async def get_league_summary(self) -> LeagueSummary:
        """Get league summary statistics"""
        # None while LIVE_STANDINGS_ENABLED is off: official frames, no ``live`` block.
        live_state = await self.data_provider.get_live_state(include_finals=True)
        live = live_state is not None

        async def _fetch_league_averages():
            averages_df = await (self.data_provider.get_averages_df(live=True) if live
                                 else self.data_provider.get_averages_df())
            if averages_df is None:
                raise ResourceNotFoundError("Unable to fetch averages data from ESPN API")

            categories = await self.data_provider.get_ranking_categories()
            reverse_categories = await self.data_provider.get_reverse_categories()
            category_leaders = self._calculate_category_leaders(averages_df, categories, reverse_categories)
            league_averages = self._calculate_league_averages(averages_df, categories)
            return averages_df, category_leaders, league_averages

        async def _fetch_nba_stats():
            try:
                nba_service = NBAStatsService()
                return await asyncio.gather(
                    nba_service.get_nba_average_pace(settings.season_id),
                    nba_service.get_nba_game_days_remaining(settings.season_id),
                    nba_service.get_nba_game_days_elapsed(settings.season_id),
                )
            except Exception as e:
                self.logger.warning(f"Failed to fetch NBA stats: {e}")
                return None, None, None

        # The ESPN league fetch and the NBA-wide stats fetch are independent —
        # overlap them instead of paying both round trips serially.
        (averages_df, category_leaders, league_averages), (nba_avg_pace, nba_game_days_left, nba_game_days_elapsed) = \
            await asyncio.gather(_fetch_league_averages(), _fetch_nba_stats())

        trade_deadline = await self.data_provider.get_trade_deadline()
        espn_updated_at = await self.data_provider.get_standings_updated_at()

        response = self.response_builder.build_league_summary_response(
            total_teams=len(averages_df),
            total_games_played=int(averages_df['GP'].sum()),
            category_leaders=category_leaders,
            league_averages=league_averages,
            nba_avg_pace=nba_avg_pace,
            nba_game_days_left=nba_game_days_left,
            nba_game_days_elapsed=nba_game_days_elapsed,
            data_date=self.data_provider.get_data_date(),
            trade_deadline=trade_deadline,
            espn_updated_at=espn_updated_at,
        )
        if live_state is not None and live_state.active:
            response.league_averages_official = await self._official_league_averages()
        return with_live(response, live_state)

    async def _official_league_averages(self) -> Optional[AverageStats]:
        """This morning's official league averages, for marking the Today
        tiles tonight moved. None on failure: the tiles then show no marks."""
        try:
            official_df = await self.data_provider.get_averages_df()
            return self._calculate_league_averages(official_df, await self.data_provider.get_ranking_categories())
        except Exception as e:
            self.logger.warning(f"Official league averages unavailable: {type(e).__name__}: {e}")
            return None
    
    async def get_heatmap_data(self, start_date: Optional[date] = None, end_date: Optional[date] = None) -> HeatmapData:
        """Get data for heatmap visualization"""
        if start_date is not None and end_date is not None:
            return await self._get_heatmap_for_range(start_date, end_date)
        live_state = await self.data_provider.get_live_state(include_finals=True)
        if live_state is None:
            return await self.data_provider.memo_response('heatmap', (), self._get_season_heatmap)
        response = await self.data_provider.memo_response(
            'heatmap', (), lambda: self._get_season_heatmap(live=True), live=True
        )
        return await self._with_tonight_gp(response, live_state)

    async def _get_season_heatmap(self, live: bool = False) -> HeatmapData:
        averages_df = await (self.data_provider.get_averages_df(live=True) if live
                             else self.data_provider.get_averages_df())
        if averages_df is None:
            raise ResourceNotFoundError("Unable to fetch averages data from ESPN API")

        rankings_df = await (self.data_provider.get_rankings_df(live=True) if live
                             else self.data_provider.get_rankings_df())
        if rankings_df is None:
            raise ResourceNotFoundError("Unable to fetch rankings data from ESPN API")

        rankings_df = rankings_df.sort_values(by='TOTAL_POINTS', ascending=False)

        sorted_averages_df = averages_df.set_index('team_id').loc[rankings_df['team_id']].reset_index()

        categories = await self.data_provider.get_ranking_categories()
        reverse_categories = await self.data_provider.get_reverse_categories()
        # A resolved category can be absent from the frame (DB fallback data is
        # fixed to the historical 8 columns even when ESPN settings resolve
        # more). Narrow to what's actually present so the labels, the value
        # matrix, the normalized matrix and the ranks all describe the same
        # columns instead of silently shifting against each other.
        categories = [c for c in categories
                      if c in sorted_averages_df.columns and c in rankings_df.columns]
        teams_data = self._extract_teams_data(sorted_averages_df)
        categories_data = self._extract_categories_data(sorted_averages_df, categories)
        normalized_data = self.stats_calculator.normalize_for_heatmap(sorted_averages_df, categories, reverse_categories)
        ranks_data = self._extract_ranks_data(rankings_df, sorted_averages_df, categories)

        return self.response_builder.build_heatmap_response(
            teams=teams_data,
            categories=categories_data,
            normalized_data=normalized_data,
            ranks_data=ranks_data,
            data_date=self.data_provider.get_data_date(),
            category_labels=categories + ['GP'],
        )

    async def _get_heatmap_for_range(self, start_date: date, end_date: date) -> HeatmapData:
        from app.services.ranking_service import RankingService

        ranking_service = RankingService()
        actual_start_date, actual_end_date, delta_df, _, live_state = \
            await ranking_service.range_deltas(start_date, end_date)

        categories = await self.data_provider.get_ranking_categories()
        reverse_categories = await self.data_provider.get_reverse_categories()

        averages_df, averages_rankings_df = ranking_service._build_averages_rankings_df(
            delta_df, categories, reverse_categories
        )
        rankings_df = averages_rankings_df.sort_values(by='TOTAL_POINTS', ascending=False)

        sorted_averages_df = averages_df.set_index('team_id').loc[rankings_df['team_id']].reset_index()

        # Same narrowing as the live path: a resolved category can be missing
        # from rows written before it was added to the league, and the labels,
        # values, normalized matrix and ranks all have to describe the same
        # columns.
        categories = [c for c in categories
                      if c in sorted_averages_df.columns and c in rankings_df.columns]
        teams_data = self._extract_teams_data(sorted_averages_df)
        categories_data = self._extract_categories_data(sorted_averages_df, categories)
        normalized_data = self.stats_calculator.normalize_for_heatmap(
            sorted_averages_df, categories, reverse_categories
        )
        ranks_data = self._extract_ranks_data(rankings_df, sorted_averages_df, categories)

        response = self.response_builder.build_heatmap_response(
            teams=teams_data,
            categories=categories_data,
            normalized_data=normalized_data,
            ranks_data=ranks_data,
            date_range_start=start_date,
            date_range_end=end_date,
            actual_start_date=actual_start_date,
            actual_end_date=actual_end_date,
            category_labels=categories + ['GP'],
        )
        return await self._with_tonight_gp(response, live_state)

    async def _with_tonight_gp(self, response: HeatmapData, live_state) -> HeatmapData:
        """The ``live`` block, plus the GP column's "+N" (games counted
        tonight, finished games only) while tonight is live."""
        if live_state is not None and live_state.active:
            try:
                official = await self.data_provider.get_averages_df()
                live = await self.data_provider.get_averages_df(live=True)
                gp = tonight_changes.gp_tonight(official, live, [t.team_id for t in response.teams])
                response = response.model_copy(update={'gp_tonight': gp})
            except Exception as e:
                self.logger.warning(f"Heatmap GP tonight unavailable: {type(e).__name__}: {e}")
        return with_live(response, live_state)
    
    async def get_league_shots_data(self) -> LeagueShotsData:
        """Get league-wide shooting statistics"""
        totals_df = await self.data_provider.get_totals_df()
        if totals_df is None:
            raise ResourceNotFoundError("Unable to fetch totals data from ESPN API")
        
        shots_data = self._extract_shots_data(totals_df)

        return self.response_builder.build_league_shots_response(
            shots_data, data_date=self.data_provider.get_data_date()
        )
    
    def _calculate_category_leaders(self, averages_df, categories: Optional[List[str]] = None,
                                  reverse_categories: Optional[set] = None) -> Dict[str, RankingStats]:
        """Calculate category leaders (business logic). categories defaults to RANKING_CATEGORIES."""
        leaders_data = self.stats_calculator.find_category_leaders(averages_df, categories, reverse_categories)
        category_leaders = {}

        for category, data in leaders_data.items():
            team_row = averages_df[averages_df['team_id'] == data['team_id']].iloc[0]
            category_leaders[category] = self.response_builder.create_ranking_stats_from_averages(team_row, categories)

        return category_leaders

    def _calculate_league_averages(self, averages_df, categories: Optional[List[str]] = None) -> AverageStats:
        """Calculate league averages (business logic). categories defaults to RANKING_CATEGORIES."""
        league_avg_data = self.stats_calculator.calculate_league_averages(averages_df, categories)
        return self.response_builder.create_average_stats(league_avg_data, categories)
    
    def _extract_teams_data(self, averages_df) -> List:
        """Extract teams data for heatmap"""
        return [{'team_id': int(row['team_id']), 'team_name': str(row['team_name'])} 
                for _, row in averages_df.iterrows()]
    
    def _extract_categories_data(self, averages_df, categories: Optional[List[str]] = None) -> List:
        """Extract categories data for heatmap. categories defaults to RANKING_CATEGORIES."""
        from app.utils.constants import RANKING_CATEGORIES
        categories_with_gp = (categories or RANKING_CATEGORIES) + ['GP']
        return averages_df[categories_with_gp].values.tolist()

    def _extract_ranks_data(self, rankings_df, averages_df, categories: Optional[List[str]] = None) -> List[List[int]]:
        """Extract rank data for each team and category. categories defaults to RANKING_CATEGORIES."""
        from app.utils.constants import RANKING_CATEGORIES
        categories = categories or RANKING_CATEGORIES

        team_id_to_ranks = {}
        for _, row in rankings_df.iterrows():
            team_id = int(row['team_id'])
            ranks = [int(row[cat]) for cat in categories]
            ranks.append(0)
            team_id_to_ranks[team_id] = ranks

        default_ranks = [0] * (len(categories) + 1)
        ranks_data = []
        for _, team_row in averages_df.iterrows():
            team_id = int(team_row['team_id'])
            ranks_data.append(team_id_to_ranks.get(team_id, default_ranks))

        return ranks_data

    def _extract_shots_data(self, totals_df) -> List:
        """Extract shots data for league shots"""
        shots_data = []
        for _, row in totals_df.iterrows():
            shots_data.append({
                'team_id': int(row['team_id']),
                'team_name': str(row['team_name']),
                'fgm': int(row['FGM']),
                'fga': int(row['FGA']),
                'fg_percentage': float(row['FG%']),
                'ftm': int(row['FTM']),
                'fta': int(row['FTA']),
                'ft_percentage': float(row['FT%']),
                'gp': int(row['GP'])
            })
        return shots_data

import logging
import pandas as pd
from datetime import date
from typing import Dict, List, Optional
from app.models import LeagueSummary, HeatmapData, LeagueShotsData, AverageStats, RankingStats
from app.services.data_provider import DataProvider
from app.services.stats_calculator import StatsCalculator
from app.services.nba_stats_service import NBAStatsService
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
        averages_df = await self.data_provider.get_averages_df()
        if averages_df is None:
            raise ResourceNotFoundError("Unable to fetch averages data from ESPN API")

        category_leaders = self._calculate_category_leaders(averages_df)
        league_averages = self._calculate_league_averages(averages_df)

        nba_avg_pace = None
        nba_game_days_left = None

        try:
            nba_service = NBAStatsService()
            nba_avg_pace = await nba_service.get_nba_average_pace(settings.season_id)
            nba_game_days_left = await nba_service.get_nba_game_days_remaining()
            await nba_service.close()
        except Exception as e:
            self.logger.warning(f"Failed to fetch NBA stats: {e}")

        return self.response_builder.build_league_summary_response(
            total_teams=len(averages_df),
            total_games_played=int(averages_df['GP'].sum()),
            category_leaders=category_leaders,
            league_averages=league_averages,
            nba_avg_pace=nba_avg_pace,
            nba_game_days_left=nba_game_days_left,
            data_date=self.data_provider.get_data_date(),
        )
    
    async def get_heatmap_data(self, start_date: Optional[date] = None, end_date: Optional[date] = None) -> HeatmapData:
        """Get data for heatmap visualization"""
        if start_date is not None and end_date is not None:
            return await self._get_heatmap_for_range(start_date, end_date)

        averages_df = await self.data_provider.get_averages_df()
        if averages_df is None:
            raise ResourceNotFoundError("Unable to fetch averages data from ESPN API")

        rankings_df = await self.data_provider.get_rankings_df()
        if rankings_df is None:
            raise ResourceNotFoundError("Unable to fetch rankings data from ESPN API")

        rankings_df = rankings_df.sort_values(by='TOTAL_POINTS', ascending=False)

        sorted_averages_df = averages_df.set_index('team_id').loc[rankings_df['team_id']].reset_index()

        teams_data = self._extract_teams_data(sorted_averages_df)
        categories_data = self._extract_categories_data(sorted_averages_df)
        normalized_data = self.stats_calculator.normalize_for_heatmap(sorted_averages_df)
        ranks_data = self._extract_ranks_data(rankings_df, sorted_averages_df)

        return self.response_builder.build_heatmap_response(
            teams=teams_data,
            categories=categories_data,
            normalized_data=normalized_data,
            ranks_data=ranks_data,
            data_date=self.data_provider.get_data_date(),
        )

    async def _get_heatmap_for_range(self, start_date: date, end_date: date) -> HeatmapData:
        from app.services.ranking_service import RankingService
        from app.services.data_transformer import DataTransformer

        actual_end_date, actual_start_date, rows_end, rows_start = \
            await self.data_provider.db_service.get_snapshots_for_date_range(start_date, end_date)

        if actual_end_date is None or not rows_end:
            raise ResourceNotFoundError("No data available for the requested date range")

        ranking_service = RankingService()
        end_df = pd.DataFrame(rows_end)
        start_df = pd.DataFrame(rows_start) if rows_start else None
        delta_df = ranking_service._compute_delta(end_df, start_df)

        averages_rankings_df = ranking_service._build_averages_rankings_df(delta_df)
        rankings_df = averages_rankings_df.sort_values(by='TOTAL_POINTS', ascending=False)

        transformer = DataTransformer()
        averages_df = pd.DataFrame()
        averages_df['team_id'] = delta_df['team_id']
        averages_df['team_name'] = delta_df['team_name']
        averages_df['GP'] = delta_df['gp']
        averages_df['FGM'] = delta_df['fgm']
        averages_df['FGA'] = delta_df['fga']
        averages_df['FTM'] = delta_df['ftm']
        averages_df['FTA'] = delta_df['fta']
        averages_df['FG%'] = delta_df['fg_pct']
        averages_df['FT%'] = delta_df['ft_pct']
        averages_df['3PM'] = delta_df['three_pm']
        averages_df['REB'] = delta_df['reb']
        averages_df['AST'] = delta_df['ast']
        averages_df['STL'] = delta_df['stl']
        averages_df['BLK'] = delta_df['blk']
        averages_df['PTS'] = delta_df['pts']
        averages_df = transformer.totals_to_averages_df(averages_df)

        sorted_averages_df = averages_df.set_index('team_id').loc[rankings_df['team_id']].reset_index()

        teams_data = self._extract_teams_data(sorted_averages_df)
        categories_data = self._extract_categories_data(sorted_averages_df)
        normalized_data = self.stats_calculator.normalize_for_heatmap(sorted_averages_df)
        ranks_data = self._extract_ranks_data(rankings_df, sorted_averages_df)

        return self.response_builder.build_heatmap_response(
            teams=teams_data,
            categories=categories_data,
            normalized_data=normalized_data,
            ranks_data=ranks_data,
            date_range_start=start_date,
            date_range_end=end_date,
            actual_start_date=actual_start_date,
            actual_end_date=actual_end_date,
        )
    
    async def get_league_shots_data(self) -> LeagueShotsData:
        """Get league-wide shooting statistics"""
        totals_df = await self.data_provider.get_totals_df()
        if totals_df is None:
            raise ResourceNotFoundError("Unable to fetch totals data from ESPN API")
        
        shots_data = self._extract_shots_data(totals_df)

        return self.response_builder.build_league_shots_response(
            shots_data, data_date=self.data_provider.get_data_date()
        )
    
    def _calculate_category_leaders(self, averages_df) -> Dict[str, RankingStats]:
        """Calculate category leaders (business logic)"""
        leaders_data = self.stats_calculator.find_category_leaders(averages_df)
        category_leaders = {}
        
        for category, data in leaders_data.items():
            team_row = averages_df[averages_df['team_id'] == data['team_id']].iloc[0]
            category_leaders[category] = self.response_builder.create_ranking_stats_from_averages(team_row)
        
        return category_leaders
    
    def _calculate_league_averages(self, averages_df) -> AverageStats:
        """Calculate league averages (business logic)"""
        league_avg_data = self.stats_calculator.calculate_league_averages(averages_df)
        return self.response_builder.create_average_stats(league_avg_data)
    
    def _extract_teams_data(self, averages_df) -> List:
        """Extract teams data for heatmap"""
        return [{'team_id': int(row['team_id']), 'team_name': str(row['team_name'])} 
                for _, row in averages_df.iterrows()]
    
    def _extract_categories_data(self, averages_df) -> List:
        """Extract categories data for heatmap"""
        from app.utils.constants import RANKING_CATEGORIES
        categories_with_gp = RANKING_CATEGORIES + ['GP']
        return averages_df[categories_with_gp].values.tolist()

    def _extract_ranks_data(self, rankings_df, averages_df) -> List[List[int]]:
        """Extract rank data for each team and category"""
        from app.utils.constants import RANKING_CATEGORIES

        team_id_to_ranks = {}
        for _, row in rankings_df.iterrows():
            team_id = int(row['team_id'])
            ranks = [int(row[cat]) for cat in RANKING_CATEGORIES]
            ranks.append(0)
            team_id_to_ranks[team_id] = ranks

        ranks_data = []
        for _, team_row in averages_df.iterrows():
            team_id = int(team_row['team_id'])
            ranks_data.append(team_id_to_ranks.get(team_id, [0] * 9))

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

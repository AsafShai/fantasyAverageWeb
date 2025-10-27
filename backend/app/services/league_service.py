import logging
from datetime import datetime
from typing import Dict, List
from app.models import LeagueSummary, HeatmapData, LeagueShotsData, AverageStats, RankingStats
from app.services.data_provider import DataProvider
from app.services.stats_calculator import StatsCalculator
from app.builders.response_builder import ResponseBuilder
from app.exceptions import ResourceNotFoundError

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
        
        return self.response_builder.build_league_summary_response(
            total_teams=len(averages_df),
            total_games_played=int(averages_df['GP'].sum()),
            category_leaders=category_leaders,
            league_averages=league_averages
        )
    
    async def get_heatmap_data(self) -> HeatmapData:
        """Get data for heatmap visualization"""
        averages_df = await self.data_provider.get_averages_df()
        if averages_df is None:
            raise ResourceNotFoundError("Unable to fetch averages data from ESPN API")

        rankings_df = await self.data_provider.get_rankings_df()
        if rankings_df is None:
            raise ResourceNotFoundError("Unable to fetch rankings data from ESPN API")

        teams_data = self._extract_teams_data(averages_df)
        categories_data = self._extract_categories_data(averages_df)
        normalized_data = self.stats_calculator.normalize_for_heatmap(averages_df)
        ranks_data = self._extract_ranks_data(rankings_df, averages_df)

        return self.response_builder.build_heatmap_response(
            teams=teams_data,
            categories=categories_data,
            normalized_data=normalized_data,
            ranks_data=ranks_data
        )
    
    async def get_league_shots_data(self) -> LeagueShotsData:
        """Get league-wide shooting statistics"""
        totals_df = await self.data_provider.get_totals_df()
        if totals_df is None:
            raise ResourceNotFoundError("Unable to fetch totals data from ESPN API")
        
        shots_data = self._extract_shots_data(totals_df)
        
        return self.response_builder.build_league_shots_response(shots_data)
    
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

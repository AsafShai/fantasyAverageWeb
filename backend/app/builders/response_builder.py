import pandas as pd
from datetime import datetime
from typing import Dict, List, Optional
from app.models.fantasy import (
    ShotChartStats, RawAverageStats, RankingStats,
    TeamDetail, LeagueRankings, LeagueSummary, HeatmapData, 
    TeamShotStats, LeagueShotsData, TeamPlayers, Player, PlayerStats
)
from app.utils.constants import RANKING_CATEGORIES
from app.services.stats_calculator import StatsCalculator


class ResponseBuilder:
    """Builds API response objects from processed DataFrames"""
    
    def __init__(self):
        self.stats_calculator = StatsCalculator()
    
    def build_rankings_response(self, rankings_df: pd.DataFrame, 
                              sort_by: Optional[str] = None, 
                              order: str = "desc") -> LeagueRankings:
        """
        Build LeagueRankings response from rankings DataFrame
        Args:
            rankings_df: DataFrame with rankings data
            sort_by: Column to sort by (optional)
            order: Sort order ('asc' or 'desc')
        Returns:
            LeagueRankings response object
        """
        # Apply sorting if requested
        if sort_by and sort_by in rankings_df.columns:
            ascending = order == "asc"
            rankings_df = rankings_df.sort_values(sort_by, ascending=ascending)
        
        # Convert to RankingStats objects
        rankings = [self._create_ranking_stats(row) for _, row in rankings_df.iterrows()]
        
        return LeagueRankings(
            rankings=rankings,
            categories=RANKING_CATEGORIES + ['Total_Points'],
            last_updated=datetime.now()
        )
    
    def build_team_detail_response(self, team_name: str, totals_df: pd.DataFrame,
                                 averages_df: pd.DataFrame, rankings_df: pd.DataFrame) -> TeamDetail:
        """
        Build TeamDetail response for a specific team
        Args:
            team_name: Name of the team
            totals_df: DataFrame with total stats
            averages_df: DataFrame with averages
            rankings_df: DataFrame with rankings
        Returns:
            TeamDetail response object
        """
        if team_name not in totals_df.index:
            raise ValueError(f"Team '{team_name}' not found")
        
        # Get data for this team
        totals_data = totals_df.loc[team_name]
        avg_data = averages_df.loc[team_name]
        rank_data = rankings_df[rankings_df['Team'] == team_name].iloc[0]
        
        # Create response objects
        shot_chart = self._create_shot_chart_stats(team_name, totals_data)
        raw_averages = self._create_raw_average_stats(team_name, avg_data)
        ranking_stats = self._create_ranking_stats(rank_data)
        
        return TeamDetail(
            team=team_name,
            shot_chart=shot_chart,
            raw_averages=raw_averages,
            ranking_stats=ranking_stats,
            category_ranks={col: int(rank_data[col]) for col in RANKING_CATEGORIES}
        )
    
    def build_league_summary_response(self, averages_df: pd.DataFrame) -> LeagueSummary:
        """
        Build LeagueSummary response from averages DataFrame
        Args:
            averages_df: DataFrame with per-game averages
        Returns:
            LeagueSummary response object
        """
        # Calculate category leaders
        leaders_data = self.stats_calculator.find_category_leaders(averages_df)
        leaders = {}
        
        for category, data in leaders_data.items():
            # Convert to RankingStats object
            team_data = averages_df.loc[data['team']]
            leaders[category] = self._create_ranking_stats_from_averages(data['team'], team_data)
        
        # Calculate league averages
        league_avg_data = self.stats_calculator.calculate_league_averages(averages_df)
        league_averages = RawAverageStats(
            team="League Average",
            fg_percentage=league_avg_data['FG%'],
            ft_percentage=league_avg_data['FT%'],
            three_pm=league_avg_data['3PM'],
            ast=league_avg_data['AST'],
            reb=league_avg_data['REB'],
            stl=league_avg_data['STL'],
            blk=league_avg_data['BLK'],
            pts=league_avg_data['PTS'],
            gp=int(league_avg_data['GP'])
        )
        
        return LeagueSummary(
            total_teams=len(averages_df),
            total_games_played=int(averages_df['GP'].sum()),
            category_leaders=leaders,
            league_averages=league_averages,
            last_updated=datetime.now()
        )
    
    def build_heatmap_response(self, averages_df: pd.DataFrame) -> HeatmapData:
        """
        Build HeatmapData response from averages DataFrame
        Args:
            averages_df: DataFrame with per-game averages
        Returns:
            HeatmapData response object
        """
        teams = averages_df.index.tolist()
        data = averages_df[RANKING_CATEGORIES].values.tolist()
        normalized_data = self.stats_calculator.normalize_for_heatmap(averages_df)
        
        return HeatmapData(
            teams=teams,
            categories=RANKING_CATEGORIES,
            data=data,
            normalized_data=normalized_data
        )
    
    def build_category_rankings_response(self, category: str, averages_df: pd.DataFrame) -> List[Dict]:
        """
        Build category rankings response
        Args:
            category: Statistical category to rank by
            averages_df: DataFrame with per-game averages
        Returns:
            List of team rankings for the category
        """
        if category not in averages_df.columns:
            return []
        
        return (averages_df.reset_index()
                .sort_values(category, ascending=False)
                .to_dict('records'))
    
    def _create_ranking_stats(self, row: pd.Series) -> RankingStats:
        """Create RankingStats object from dataframe row"""
        return RankingStats(
            team=str(row['Team']),
            fg_percentage=float(row['FG%']),
            ft_percentage=float(row['FT%']),
            three_pm=float(row['3PM']),
            ast=float(row['AST']),
            reb=float(row['REB']),
            stl=float(row['STL']),
            blk=float(row['BLK']),
            pts=float(row['PTS']),
            total_points=float(row['Total_Points']),
            rank=int(row['Rank'])
        )
    
    def _create_ranking_stats_from_averages(self, team_name: str, team_data: pd.Series) -> RankingStats:
        """Create RankingStats object from averages data (for category leaders)"""
        return RankingStats(
            team=team_name,
            fg_percentage=float(team_data['FG%']),
            ft_percentage=float(team_data['FT%']),
            three_pm=float(team_data['3PM']),
            ast=float(team_data['AST']),
            reb=float(team_data['REB']),
            stl=float(team_data['STL']),
            blk=float(team_data['BLK']),
            pts=float(team_data['PTS']),
            total_points=0.0  # Not applicable for category leaders
        )
    
    def _create_shot_chart_stats(self, team_name: str, totals_data: pd.Series) -> ShotChartStats:
        """Create ShotChartStats object from totals data"""
        return ShotChartStats(
            team=team_name,
            fgm=int(totals_data['FGM']),
            fga=int(totals_data['FGA']),
            fg_percentage=float(totals_data['FG%']),
            ftm=int(totals_data['FTM']),
            fta=int(totals_data['FTA']),
            ft_percentage=float(totals_data['FT%']),
            gp=int(totals_data['GP'])
        )
    
    def _create_raw_average_stats(self, team_name: str, avg_data: pd.Series) -> RawAverageStats:
        """Create RawAverageStats object from averages data"""
        return RawAverageStats(
            team=team_name,
            fg_percentage=float(avg_data['FG%']),
            ft_percentage=float(avg_data['FT%']),
            three_pm=float(avg_data['3PM']),
            ast=float(avg_data['AST']),
            reb=float(avg_data['REB']),
            stl=float(avg_data['STL']),
            blk=float(avg_data['BLK']),
            pts=float(avg_data['PTS']),
            gp=int(avg_data['GP'])
        )
    
    def build_league_shots_response(self, totals_df: pd.DataFrame) -> LeagueShotsData:
        """
        Build LeagueShotsData response from totals DataFrame
        Args:
            totals_df: DataFrame with total stats
        Returns:
            LeagueShotsData response object
        """
        shots = []
        for team_name, totals_data in totals_df.iterrows():
            shots.append(TeamShotStats(
                team=str(team_name),
                fgm=int(totals_data['FGM']),
                fga=int(totals_data['FGA']),
                fg_percentage=float(totals_data['FG%']),
                ftm=int(totals_data['FTM']),
                fta=int(totals_data['FTA']),
                ft_percentage=float(totals_data['FT%']),
                gp=int(totals_data['GP'])
            ))
        
        return LeagueShotsData(
            shots=shots,
            last_updated=datetime.now()
        )
    
    def build_team_players_response(self, team_name: str, team_players: pd.Series) -> TeamPlayers:
        """
        Build TeamPlayers response from players DataFrame
        Args:
            team_name: Name of the team
            players_df: DataFrame with player stats
        Returns:
            TeamPlayers response object
        """
        players = []
        for _, row in team_players.iterrows():
            players.append(Player(
                player_name=str(row['Name']),
                pro_team=str(row['Pro Team']),
                positions=str(row['Positions']).split(', '),
                stats=PlayerStats(
                    pts=float(row['PTS']),
                    reb=float(row['REB']),
                    ast=float(row['AST']),
                    stl=float(row['STL']),
                    blk=float(row['BLK']),
                    fgm=float(row['FGM']),
                    fga=float(row['FGA']),
                    ftm=float(row['FTM']),
                    fta=float(row['FTA']),
                    fg_percentage=float(row['FG%']),
                    ft_percentage=float(row['FT%']),
                    three_pm=float(row['3PM']),
                    gp=int(row['GP'])
                )
            ))
        return TeamPlayers(team=team_name, players=players, last_updated=datetime.now())
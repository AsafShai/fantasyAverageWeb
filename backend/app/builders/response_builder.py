import pandas as pd
from datetime import datetime
from typing import Dict, List, Optional
from app.models import (
    ShotChartStats, AverageStats, TeamAverageStats, RankingStats,
    TeamDetail, LeagueRankings, LeagueSummary, HeatmapData,
    TeamShotStats, LeagueShotsData, TeamPlayers, Player, PlayerStats, Team
)
from app.utils.constants import RANKING_CATEGORIES


class ResponseBuilder:
    """Transforms data into API response objects (pure data transformation)"""
    
    def build_rankings_response(self, rankings_df: pd.DataFrame, 
                              sort_by: Optional[str] = None, 
                              order: str = "asc") -> LeagueRankings:
        """Build LeagueRankings response from rankings DataFrame"""
        # Apply sorting if requested, otherwise sort by rank
        sort_by = "RANK" if sort_by is None else sort_by.upper()
        ascending = order == "asc"
        rankings_df = rankings_df.sort_values(sort_by, ascending=ascending)
        
        # Convert to RankingStats objects
        rankings = [self._create_ranking_stats(row) for _, row in rankings_df.iterrows()]
        
        return LeagueRankings(
            rankings=rankings,
            categories=RANKING_CATEGORIES + ['TOTAL_POINTS'],
            last_updated=datetime.now()
        )
    
    def build_team_detail_response(self, team_id: int, totals_df: pd.DataFrame,
                                 averages_df: pd.DataFrame, rankings_df: pd.DataFrame,
                                 players: List[Player], espn_url: str) -> TeamDetail:
        """Build TeamDetail response for a specific team"""
        # Find team data
        team_row = totals_df[totals_df['team_id'] == team_id]
        if team_row.empty:
            raise ValueError(f"Team '{team_id}' not found")
        totals_data = team_row.iloc[0]

        avg_row = averages_df[averages_df['team_id'] == team_id]
        if avg_row.empty:
            raise ValueError(f"Team '{team_id}' not found in averages")
        avg_data = avg_row.iloc[0]

        rank_data = rankings_df[rankings_df['team_id'] == team_id].iloc[0]

        # Transform data to response objects
        team = Team(team_id=team_id, team_name=totals_data['team_name'])
        shot_chart = self._create_shot_chart_stats(totals_data)
        raw_averages = self._create_raw_average_stats(avg_data)
        ranking_stats = self._create_ranking_stats(rank_data)

        return TeamDetail(
            team=team,
            espn_url=espn_url,
            players=players,
            shot_chart=shot_chart,
            raw_averages=raw_averages,
            ranking_stats=ranking_stats,
            category_ranks={col: int(rank_data[col]) for col in RANKING_CATEGORIES}
        )
    
    def build_league_summary_response(self, total_teams: int, total_games_played: int,
                                    category_leaders: Dict[str, RankingStats], 
                                    league_averages: AverageStats) -> LeagueSummary:
        """Build LeagueSummary response from calculated data"""
        return LeagueSummary(
            total_teams=total_teams,
            total_games_played=total_games_played,
            category_leaders=category_leaders,
            league_averages=league_averages,
            last_updated=datetime.now()
        )
    
    def build_heatmap_response(self, teams: List[Dict], categories: List[List[float]],
                             normalized_data: List[List[float]], ranks_data: List[List[int]]) -> HeatmapData:
        """Build HeatmapData response from prepared data"""
        team_objects = [Team(team_id=team['team_id'], team_name=team['team_name'])
                       for team in teams]
        categories_with_gp = RANKING_CATEGORIES + ['GP']

        return HeatmapData(
            teams=team_objects,
            categories=categories_with_gp,
            data=categories,
            normalized_data=normalized_data,
            ranks_data=ranks_data
        )
    
    def build_league_shots_response(self, shots_data: List[Dict]) -> LeagueShotsData:
        """Build LeagueShotsData response from prepared shots data"""
        shots = []
        for shot_data in shots_data:
            shots.append(TeamShotStats(
                team=Team(team_id=shot_data['team_id'], team_name=shot_data['team_name']),
                fgm=shot_data['fgm'],
                fga=shot_data['fga'],
                fg_percentage=shot_data['fg_percentage'],
                ftm=shot_data['ftm'],
                fta=shot_data['fta'],
                ft_percentage=shot_data['ft_percentage'],
                gp=shot_data['gp']
            ))
        
        return LeagueShotsData(
            shots=shots,
            last_updated=datetime.now()
        )
    
    def build_players_list(self, team_players: pd.DataFrame) -> List[Player]:
        """Build list of Player objects from players DataFrame"""
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
                    minutes=float(row['MIN']),
                    gp=int(row['GP'])
                ),
                team_id=int(row['team_id']),
                status=str(row.get('status', 'ONTEAM'))
            ))
        return players

    def build_team_players_response(self, team_players: pd.DataFrame) -> TeamPlayers:
        """Build TeamPlayers response from players DataFrame"""
        players = self.build_players_list(team_players)
        return TeamPlayers(
            team_id=team_players.iloc[0]['team_id'],
            players=players,
            last_updated=datetime.now()
        )
    
    # Helper methods for data transformation
    def create_ranking_stats_from_averages(self, team_data: pd.Series) -> RankingStats:
        """Create RankingStats object from averages data"""
        return RankingStats(
            team=Team(team_id=int(team_data['team_id']), team_name=str(team_data['team_name'])),
            fg_percentage=float(team_data['FG%']),
            ft_percentage=float(team_data['FT%']),
            three_pm=float(team_data['3PM']),
            ast=float(team_data['AST']),
            reb=float(team_data['REB']),
            stl=float(team_data['STL']),
            blk=float(team_data['BLK']),
            pts=float(team_data['PTS']),
            gp=int(team_data['GP']),
            total_points=0.0
        )
    
    def create_average_stats(self, league_avg_data: Dict) -> AverageStats:
        """Create AverageStats object from calculated data"""
        return AverageStats(
            fg_percentage=league_avg_data['FG%'],
            ft_percentage=league_avg_data['FT%'],
            three_pm=league_avg_data['3PM'],
            ast=league_avg_data['AST'],
            reb=league_avg_data['REB'],
            stl=league_avg_data['STL'],
            blk=league_avg_data['BLK'],
            pts=league_avg_data['PTS'],
            gp=float(league_avg_data['GP'])
        )
    
    def _create_ranking_stats(self, row: pd.Series) -> RankingStats:
        """Create RankingStats object from dataframe row"""
        return RankingStats(
            team=Team(team_id=int(row['team_id']), team_name=str(row['team_name'])),
            fg_percentage=float(row['FG%']),
            ft_percentage=float(row['FT%']),
            three_pm=float(row['3PM']),
            ast=float(row['AST']),
            reb=float(row['REB']),
            stl=float(row['STL']),
            blk=float(row['BLK']),
            pts=float(row['PTS']),
            gp=int(row['GP']),
            total_points=float(row['TOTAL_POINTS']),
            rank=int(row['RANK'])
        )
    
    def _create_shot_chart_stats(self, totals_data: pd.Series) -> ShotChartStats:
        """Create ShotChartStats object from totals data"""
        return ShotChartStats(
            team=Team(team_id=int(totals_data['team_id']), team_name=str(totals_data['team_name'])),
            fgm=int(totals_data['FGM']),
            fga=int(totals_data['FGA']),
            fg_percentage=float(totals_data['FG%']),
            ftm=int(totals_data['FTM']),
            fta=int(totals_data['FTA']),
            ft_percentage=float(totals_data['FT%']),
            gp=int(totals_data['GP'])
        )
    
    def _create_raw_average_stats(self, avg_data: pd.Series) -> TeamAverageStats:
        """Create TeamAverageStats object from averages data"""
        return TeamAverageStats(
            team=Team(team_id=int(avg_data['team_id']), team_name=str(avg_data['team_name'])),
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

    def build_all_players_response(self, players_df: pd.DataFrame) -> List[Player]:
        """Build list of all players from players DataFrame"""
        players = []
        for _, row in players_df.iterrows():
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
                    minutes=float(row['MIN']),
                    gp=int(row['GP'])
                ),
                team_id=int(row['team_id']),
                status=str(row.get('status', 'ONTEAM'))
            ))
        return players
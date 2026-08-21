import pandas as pd
from datetime import datetime
from typing import Dict, List, Optional
from app.models import (
    ShotChartStats, AverageStats, TeamAverageStats, RankingStats,
    TeamDetail, LeagueRankings, LeagueSummary, HeatmapData,
    TeamShotStats, LeagueShotsData, TeamPlayers, Player, PlayerStats, Team, SlotUsage
)
from app.services.data_transformer import SLOT_CAPS
from app.utils.constants import RANKING_CATEGORIES
from app.config import settings


class ResponseBuilder:
    """Transforms data into API response objects (pure data transformation)"""
    
    def build_rankings_response(self, averages_df: pd.DataFrame,
                              totals_df: pd.DataFrame,
                              averages_rankings_df: pd.DataFrame,
                              totals_rankings_df: pd.DataFrame,
                              sort_by: Optional[str] = None,
                              order: str = "asc",
                              data_date=None,
                              date_range_start=None,
                              date_range_end=None,
                              actual_start_date=None,
                              actual_end_date=None,
                              categories: Optional[List[str]] = None) -> LeagueRankings:
        """Build LeagueRankings response from averages/totals rankings DataFrames (rank + total
        points per team) paired with their raw counterparts (actual per-category stat values).

        categories: this league's actual scoring categories (defaults to RANKING_CATEGORIES,
        the historical fixed 8-category set)."""
        categories = categories or RANKING_CATEGORIES
        sort_col = "RANK" if sort_by is None else sort_by.upper()
        ascending = order == "asc"

        averages_rankings_df = averages_rankings_df.sort_values(sort_col, ascending=ascending)
        totals_rankings_df = totals_rankings_df.sort_values(sort_col, ascending=ascending)

        averages_by_team = averages_df.set_index('team_id')
        totals_by_team = totals_df.set_index('team_id')

        averages_rankings = [
            self._create_ranking_stats(row, averages_by_team.loc[int(row['team_id'])], categories)
            for _, row in averages_rankings_df.iterrows()
        ]
        totals_rankings = [
            self._create_ranking_stats(row, totals_by_team.loc[int(row['team_id'])], categories)
            for _, row in totals_rankings_df.iterrows()
        ]

        return LeagueRankings(
            averages_rankings=averages_rankings,
            totals_rankings=totals_rankings,
            categories=categories + ['TOTAL_POINTS'],
            last_updated=datetime.now(),
            data_date=data_date,
            date_range_start=date_range_start,
            date_range_end=date_range_end,
            actual_start_date=actual_start_date,
            actual_end_date=actual_end_date,
        )
    
    def build_team_detail_response(self, team_id: int, totals_df: pd.DataFrame,
                                 averages_df: pd.DataFrame, rankings_df: pd.DataFrame,
                                 players: Optional[List[Player]], espn_url: str,
                                 slot_usage_raw: Dict[str, int] = None,
                                 data_date=None, actual_start=None, actual_end=None,
                                 categories: Optional[List[str]] = None) -> TeamDetail:
        """Build TeamDetail response for a specific team. categories defaults to RANKING_CATEGORIES."""
        categories = categories or RANKING_CATEGORIES
        team_row = totals_df[totals_df['team_id'] == team_id]
        if team_row.empty:
            raise ValueError(f"Team '{team_id}' not found")
        totals_data = team_row.iloc[0]

        avg_row = averages_df[averages_df['team_id'] == team_id]
        if avg_row.empty:
            raise ValueError(f"Team '{team_id}' not found in averages")
        avg_data = avg_row.iloc[0]

        rank_data = rankings_df[rankings_df['team_id'] == team_id].iloc[0]

        team = Team(team_id=team_id, team_name=totals_data['team_name'])
        shot_chart = self._create_shot_chart_stats(totals_data)
        raw_averages = self._create_raw_average_stats(avg_data, categories)
        ranking_stats = self._create_ranking_stats(rank_data, avg_data, categories)

        slot_usage: Dict[str, SlotUsage] = {}
        for slot_name, cap in SLOT_CAPS.items():
            games_used = (slot_usage_raw or {}).get(slot_name, 0)
            slot_usage[slot_name] = SlotUsage(
                games_used=games_used,
                cap=cap,
                remaining=cap - games_used
            )

        return TeamDetail(
            team=team,
            espn_url=espn_url,
            players=players,
            shot_chart=shot_chart,
            raw_averages=raw_averages,
            ranking_stats=ranking_stats,
            category_ranks={col: int(rank_data[col]) for col in categories if col in rank_data},
            slot_usage=slot_usage,
            data_date=data_date,
            actual_start=actual_start,
            actual_end=actual_end,
        )
    
    def build_league_summary_response(self, total_teams: int, total_games_played: int,
                                    category_leaders: Dict[str, RankingStats],
                                    league_averages: AverageStats,
                                    nba_avg_pace: Optional[float] = None,
                                    nba_game_days_left: Optional[int] = None,
                                    data_date=None) -> LeagueSummary:
        """Build LeagueSummary response from calculated data"""
        return LeagueSummary(
            total_teams=total_teams,
            total_games_played=total_games_played,
            nba_avg_pace=nba_avg_pace,
            nba_game_days_left=nba_game_days_left,
            category_leaders=category_leaders,
            league_averages=league_averages,
            last_updated=datetime.now(),
            data_date=data_date,
            season_start=settings.season_start,
        )
    
    def build_heatmap_response(self, teams: List[Dict], categories: List[List[float]],
                             normalized_data: List[List[float]], ranks_data: List[List[int]],
                             data_date=None, date_range_start=None, date_range_end=None,
                             actual_start_date=None, actual_end_date=None) -> HeatmapData:
        """Build HeatmapData response from prepared data"""
        team_objects = [Team(team_id=team['team_id'], team_name=team['team_name'])
                       for team in teams]
        categories_with_gp = RANKING_CATEGORIES + ['GP']

        return HeatmapData(
            teams=team_objects,
            categories=categories_with_gp,
            data=categories,
            normalized_data=normalized_data,
            ranks_data=ranks_data,
            data_date=data_date,
            date_range_start=date_range_start,
            date_range_end=date_range_end,
            actual_start_date=actual_start_date,
            actual_end_date=actual_end_date,
        )
    
    def build_league_shots_response(self, shots_data: List[Dict], data_date=None) -> LeagueShotsData:
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
            last_updated=datetime.now(),
            data_date=data_date,
        )
    
    def _player_id_from_row(self, row: pd.Series) -> Optional[int]:
        raw = row.get('player_id')
        if raw is None or (isinstance(raw, float) and pd.isna(raw)):
            return None
        try:
            value = int(raw)
        except (TypeError, ValueError):
            return None
        return value if value > 0 else None

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
                status=str(row.get('status', 'ONTEAM')),
                player_id=self._player_id_from_row(row),
                has_data=bool(row.get('has_data', True)),
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
    def create_ranking_stats_from_averages(self, team_data: pd.Series,
                                         categories: Optional[List[str]] = None) -> RankingStats:
        """Create RankingStats object from averages data. categories defaults to RANKING_CATEGORIES."""
        categories = categories or RANKING_CATEGORIES
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
            total_points=0.0,
            stats={col: float(team_data[col]) for col in categories if col in team_data},
        )

    def create_average_stats(self, league_avg_data: Dict,
                           categories: Optional[List[str]] = None) -> AverageStats:
        """Create AverageStats object from calculated data. categories defaults to RANKING_CATEGORIES."""
        categories = categories or RANKING_CATEGORIES
        return AverageStats(
            fg_percentage=league_avg_data['FG%'],
            ft_percentage=league_avg_data['FT%'],
            three_pm=league_avg_data['3PM'],
            ast=league_avg_data['AST'],
            reb=league_avg_data['REB'],
            stl=league_avg_data['STL'],
            blk=league_avg_data['BLK'],
            pts=league_avg_data['PTS'],
            gp=float(league_avg_data['GP']),
            stats={col: float(league_avg_data[col]) for col in categories if col in league_avg_data},
        )
    
    def _create_ranking_stats(self, ranked_row: pd.Series, raw_row: pd.Series,
                            categories: Optional[List[str]] = None) -> RankingStats:
        """Create RankingStats object from a ranked dataframe row (rank + total points, plus each
        category's rank-in-category) paired with the raw row holding the team's actual
        per-category stat values. categories defaults to RANKING_CATEGORIES."""
        categories = categories or RANKING_CATEGORIES
        return RankingStats(
            team=Team(team_id=int(ranked_row['team_id']), team_name=str(ranked_row['team_name'])),
            fg_percentage=float(raw_row['FG%']),
            ft_percentage=float(raw_row['FT%']),
            three_pm=float(raw_row['3PM']),
            ast=float(raw_row['AST']),
            reb=float(raw_row['REB']),
            stl=float(raw_row['STL']),
            blk=float(raw_row['BLK']),
            pts=float(raw_row['PTS']),
            gp=int(ranked_row['GP']),
            total_points=float(ranked_row['TOTAL_POINTS']),
            rank=int(ranked_row['RANK']),
            category_ranks={col: int(ranked_row[col]) for col in categories if col in ranked_row},
            stats={col: float(raw_row[col]) for col in categories if col in raw_row},
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
    
    def _create_raw_average_stats(self, avg_data: pd.Series,
                                categories: Optional[List[str]] = None) -> TeamAverageStats:
        """Create TeamAverageStats object from averages data. categories defaults to RANKING_CATEGORIES."""
        categories = categories or RANKING_CATEGORIES
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
            gp=int(avg_data['GP']),
            stats={col: float(avg_data[col]) for col in categories if col in avg_data},
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
                status=str(row.get('status', 'ONTEAM')),
                player_id=self._player_id_from_row(row),
                injured=bool(row.get('injured', False)),
                fantasy_team_name=row.get('fantasy_team_name') or None,
                season_rating=float(row['season_rating']) if row.get('season_rating') is not None else None,
                last7_rating=float(row['last7_rating']) if row.get('last7_rating') is not None else None,
                last15_rating=float(row['last15_rating']) if row.get('last15_rating') is not None else None,
                last30_rating=float(row['last30_rating']) if row.get('last30_rating') is not None else None,
                has_data=bool(row.get('has_data', True)),
            ))
        return players
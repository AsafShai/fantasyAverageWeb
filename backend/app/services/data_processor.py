import pandas as pd
import requests
from datetime import datetime
from typing import Optional, Dict, List
from app.models.fantasy import (
    ShotChartStats, RawAverageStats, RankingStats,
    TeamDetail, LeagueRankings, LeagueSummary, HeatmapData
)
from app.utils.constants import (
    ESPN_COLUMN_MAP, ALL_CATEGORIES, RANKING_CATEGORIES, 
    PER_GAME_CATEGORIES, INTEGER_COLUMNS
)
from config import ESPN_URL

class DataProcessor:
    _instance = None
    _initialized = False
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(DataProcessor, cls).__new__(cls)
        return cls._instance
    
    def __init__(self):
        if not DataProcessor._initialized:
            self._espn_url = ESPN_URL
            DataProcessor._initialized = True
    
    def _fetch_espn_data(self) -> Optional[Dict]:
        """Fetch ESPN API data"""
        try:
            response = requests.get(self._espn_url)
            response.raise_for_status()
            return response.json()
            
        except requests.RequestException as e:
            print(f"Error fetching data from API: {e}")
            return None
        except (KeyError, ValueError) as e:
            print(f"Error parsing API response: {e}")
            return None
        except Exception as e:
            print(f"Unexpected error loading data: {e}")
            return None
    
    def _extract_teams_data(self, api_data: Dict) -> pd.DataFrame:
        """Extract team data from ESPN API response"""
        teams_data = {team['name']: team['valuesByStat'] for team in api_data['teams']}
        return pd.DataFrame(teams_data).transpose()
    
    def _transform_dataframe(self, df: pd.DataFrame) -> pd.DataFrame:
        """Transform totals dataframe with proper column names and types"""
        # Rename columns using mapping
        df = df.rename(columns=ESPN_COLUMN_MAP)
        df = df[ALL_CATEGORIES]
        
        # Convert integer columns
        df[INTEGER_COLUMNS] = df[INTEGER_COLUMNS].astype(int)
        
        # Set up proper indexing
        df.reset_index(inplace=True)
        df.rename(columns={'index': 'Team'}, inplace=True)
        df.set_index('Team', inplace=True)
        
        return df
    
    def _process_espn_data_to_totals(self, espn_data: Dict) -> Optional[pd.DataFrame]:
        """Process ESPN data to create totals DataFrame"""
        try:
            df = self._extract_teams_data(espn_data)
            df = self._transform_dataframe(df)
            return df
        except Exception as e:
            print(f"Error processing ESPN data: {e}")
            return None
    
    def _calculate_averages_from_totals(self, totals_df: pd.DataFrame) -> pd.DataFrame:
        """Calculate per-game averages from totals DataFrame"""
        averages = totals_df.drop(['FGM', 'FGA', 'FTM', 'FTA'], axis=1).copy()
        averages[PER_GAME_CATEGORIES] = averages[PER_GAME_CATEGORIES].div(averages['GP'], axis=0)
        return averages.round(4)
    
    def _calculate_rankings_from_averages(self, averages_df: pd.DataFrame) -> pd.DataFrame:
        """Calculate rankings from averages DataFrame"""
        ranked = averages_df.copy()
        ranked.drop(['GP'], axis=1, inplace=True)
        ranked = ranked.rank()
        ranked['Total_Points'] = ranked.sum(axis=1)
        ranked.sort_values(by='Total_Points', ascending=False, inplace=True)
        
        ranked['Rank'] = ranked['Total_Points'].rank(method='min', ascending=False).astype(int)
        ranked.reset_index(inplace=True)
        
        return ranked
    
    def _create_ranking_stats(self, row: pd.Series) -> RankingStats:
        """Create RankingStats object from dataframe row"""
        return RankingStats(
            team=row['Team'],
            fg_percentage=float(row.get('FG%', 0.0)),
            ft_percentage=float(row.get('FT%', 0.0)),
            three_pm=float(row.get('3PM', 0.0)),
            ast=float(row.get('AST', 0.0)),
            reb=float(row.get('REB', 0.0)),
            stl=float(row.get('STL', 0.0)),
            blk=float(row.get('BLK', 0.0)),
            pts=float(row.get('PTS', 0.0)),
            total_points=float(row.get('Total_Points', 0.0)),
            rank=int(row.get('Rank', 0))
        )
    
    def get_rankings(self, sort_by: Optional[str] = None, order: str = "desc") -> LeagueRankings:
        """Get league rankings - fetches fresh data on every call"""
        # Fetch fresh ESPN data
        espn_data = self._fetch_espn_data()
        if espn_data is None:
            return LeagueRankings(rankings=[], categories=[], last_updated=datetime.now())
        
        # Process data pipeline: totals -> averages -> rankings
        totals_df = self._process_espn_data_to_totals(espn_data)
        if totals_df is None:
            return LeagueRankings(rankings=[], categories=[], last_updated=datetime.now())
        
        averages_df = self._calculate_averages_from_totals(totals_df)
        rankings_df = self._calculate_rankings_from_averages(averages_df)
        
        # Apply sorting if requested
        if sort_by and sort_by in rankings_df.columns:
            ascending = order == "asc"
            rankings_df = rankings_df.sort_values(sort_by, ascending=ascending)
        
        rankings = [self._create_ranking_stats(row) for _, row in rankings_df.iterrows()]
        
        return LeagueRankings(
            rankings=rankings,
            categories=RANKING_CATEGORIES + ['Total_Points'],
            last_updated=datetime.now()
        )
    
    def get_category_rankings(self, category: str) -> Dict:
        """Get rankings for a specific category - fetches fresh data on every call"""
        # Fetch fresh ESPN data
        espn_data = self._fetch_espn_data()
        if espn_data is None:
            return {}
        
        # Process data pipeline: totals -> averages
        totals_df = self._process_espn_data_to_totals(espn_data)
        if totals_df is None:
            return {}
        
        averages_df = self._calculate_averages_from_totals(totals_df)
        
        if category not in averages_df.columns:
            return {}
        
        return (averages_df.reset_index()
                .sort_values(category, ascending=False)
                .to_dict('records'))
    
    def get_team_detail(self, team_name: str) -> TeamDetail:
        """Get detailed team statistics - fetches fresh data on every call"""
        # Fetch fresh ESPN data
        espn_data = self._fetch_espn_data()
        if espn_data is None:
            raise ValueError("Unable to fetch ESPN data")
        
        # Process data pipeline: totals -> averages -> rankings
        totals_df = self._process_espn_data_to_totals(espn_data)
        if totals_df is None:
            raise ValueError("Unable to process ESPN data")
        
        if team_name not in totals_df.index:
            raise ValueError(f"Team '{team_name}' not found")
        
        averages_df = self._calculate_averages_from_totals(totals_df)
        rankings_df = self._calculate_rankings_from_averages(averages_df)
        
        totals_data = totals_df.loc[team_name]
        avg_data = averages_df.loc[team_name]
        rank_data = rankings_df[rankings_df['Team'] == team_name].iloc[0]
        
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
    
    def get_league_summary(self) -> LeagueSummary:
        """Get league summary statistics - fetches fresh data on every call"""
        # Fetch fresh ESPN data
        espn_data = self._fetch_espn_data()
        if espn_data is None:
            return LeagueSummary(
                total_teams=0,
                total_games_played=0,
                category_leaders={},
                league_averages=None,
                last_updated=datetime.now()
            )
        
        # Process data pipeline: totals -> averages
        totals_df = self._process_espn_data_to_totals(espn_data)
        if totals_df is None:
            return LeagueSummary(
                total_teams=0,
                total_games_played=0,
                category_leaders={},
                league_averages=None,
                last_updated=datetime.now()
            )
        
        averages_df = self._calculate_averages_from_totals(totals_df)
        
        leaders = self._find_category_leaders_from_averages(averages_df)
        league_averages = self._calculate_league_averages_from_averages(averages_df)
        
        return LeagueSummary(
            total_teams=len(averages_df),
            total_games_played=int(averages_df['GP'].sum()),
            category_leaders=leaders,
            league_averages=league_averages,
            last_updated=datetime.now()
        )
    
    def get_heatmap_data(self) -> HeatmapData:
        """Get data formatted for heatmap visualization - fetches fresh data on every call"""
        # Fetch fresh ESPN data
        espn_data = self._fetch_espn_data()
        if espn_data is None:
            return HeatmapData(teams=[], categories=[], data=[], normalized_data=[])
        
        # Process data pipeline: totals -> averages
        totals_df = self._process_espn_data_to_totals(espn_data)
        if totals_df is None:
            return HeatmapData(teams=[], categories=[], data=[], normalized_data=[])
        
        averages_df = self._calculate_averages_from_totals(totals_df)
        
        teams = averages_df.index.tolist()
        data = averages_df[RANKING_CATEGORIES].values.tolist()
        normalized_data = self._normalize_data_for_heatmap_from_averages(averages_df)
        
        return HeatmapData(
            teams=teams,
            categories=RANKING_CATEGORIES,
            data=data,
            normalized_data=normalized_data
        )
    
    def get_totals_data(self) -> Dict:
        """Get totals and processed data for debugging purposes - fetches fresh data on every call"""
        # Fetch fresh ESPN data
        espn_data = self._fetch_espn_data()
        if espn_data is None:
            return {}
        
        # Process data pipeline: totals -> averages -> rankings
        totals_df = self._process_espn_data_to_totals(espn_data)
        if totals_df is None:
            return {}
        
        averages_df = self._calculate_averages_from_totals(totals_df)
        rankings_df = self._calculate_rankings_from_averages(averages_df)
        
        # Extract ESPN timestamp
        espn_timestamp = espn_data.get('status', {}).get('standingsUpdateDate')
        
        return {
            'totals_data': totals_df.reset_index().to_dict('records'),
            'averages_data': averages_df.reset_index().to_dict('records'),
            'ranking_data': rankings_df.to_dict('records'),
            'last_updated': datetime.now().isoformat(),
            'total_teams': len(totals_df),
            'espn_timestamp': espn_timestamp
        }
    
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
    
    def _find_category_leaders_from_averages(self, averages_df: pd.DataFrame) -> Dict[str, RankingStats]:
        """Find the leader in each category from averages DataFrame"""
        leaders = {}
        for category in RANKING_CATEGORIES:
            best_team = averages_df[category].idxmax()
            team_data = averages_df.loc[best_team]
            
            leaders[f'{category}_leader'] = RankingStats(
                team=best_team,
                fg_percentage=float(team_data['FG%']),
                ft_percentage=float(team_data['FT%']),
                three_pm=float(team_data['3PM']),
                ast=float(team_data['AST']),
                reb=float(team_data['REB']),
                stl=float(team_data['STL']),
                blk=float(team_data['BLK']),
                pts=float(team_data['PTS']),
                total_points=0.0
            )
        return leaders
    
    def _calculate_league_averages_from_averages(self, averages_df: pd.DataFrame) -> RawAverageStats:
        """Calculate league-wide averages from averages DataFrame"""
        return RawAverageStats(
            team="League Average",
            fg_percentage=float(averages_df['FG%'].mean()),
            ft_percentage=float(averages_df['FT%'].mean()),
            three_pm=float(averages_df['3PM'].mean()),
            ast=float(averages_df['AST'].mean()),
            reb=float(averages_df['REB'].mean()),
            stl=float(averages_df['STL'].mean()),
            blk=float(averages_df['BLK'].mean()),
            pts=float(averages_df['PTS'].mean()),
            gp=int(averages_df['GP'].mean())
        )
    
    def _normalize_data_for_heatmap_from_averages(self, averages_df: pd.DataFrame) -> List[List[float]]:
        """Normalize data for heatmap visualization from averages DataFrame"""
        normalized_data = []
        for category in RANKING_CATEGORIES:
            col_data = averages_df[category]
            min_val, max_val = col_data.min(), col_data.max()
            if max_val - min_val > 0:
                normalized_col = ((col_data - min_val) / (max_val - min_val)).tolist()
            else:
                normalized_col = [0.5] * len(col_data)
            normalized_data.append(normalized_col)
        
        return list(map(list, zip(*normalized_data)))


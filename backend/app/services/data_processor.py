import pandas as pd
import requests
from datetime import datetime
from typing import Optional
from app.models.fantasy import (
    ShotChartStats, RawAverageStats, RankingStats,
    TeamDetail, LeagueRankings, LeagueSummary, HeatmapData
)
from config import ESPN_URL

class DataProcessor:
    def __init__(self):
        self.raw_df = None
        self.averages_df = None
        self.ranking_df = None
        self.last_updated = None
        self.espn_url = ESPN_URL
    
    def load_data_from_api(self, api_url: str = None):
        """Load data from ESPN Fantasy API"""
        try:
            url = api_url or self.espn_url
            response = requests.get(url)
            response.raise_for_status()
            data = response.json()
            
            # Extract teams data
            teams_data = {team['name']: team['valuesByStat'] for team in data['teams']}
            
            # Create DataFrame
            df = pd.DataFrame(teams_data).transpose()
            
            # Column mapping from your code
            columns_map = {
                '0': 'PTS',
                '1': 'BLK',
                '2': 'STL',
                '3': 'AST',
                '6': 'REB',
                '13': 'FGM',
                '14': 'FGA',
                '15': 'FTM',
                '16': 'FTA',
                '17': '3PM',
                '19': 'FG%',
                '20': 'FT%',
                '42': 'GP'
            }
            
            all_cats = ['FGM', 'FGA', 'FG%', 'FTM', 'FTA', 'FT%', '3PM', 'AST', 'REB', 'STL', 'BLK', 'PTS', 'GP']
            
            # Rename columns and select relevant ones
            df = df.rename(columns=columns_map)
            df = df[all_cats]
            
            # Convert integer columns
            integer_columns = ['FGM', 'FGA', 'FTM', 'FTA', '3PM', 'AST', 'REB', 'STL', 'BLK', 'PTS', 'GP']
            df[integer_columns] = df[integer_columns].astype(int)
            
            # Reset index to avoid duplicate index issues
            df.reset_index(inplace=True)
            df.rename(columns={'index': 'Team'}, inplace=True)
            df.set_index('Team', inplace=True)
            
            self.raw_df = df
            self.last_updated = datetime.now()
            return df
            
        except Exception as e:
            print(f"Error loading data from API: {e}")
            
    
    def process_data(self):
        """Process raw data using your Jupyter notebook logic"""
        if self.raw_df is None:
            self.load_data_from_api()
        
        averages = self.raw_df.drop(['FGM', 'FGA', 'FTM', 'FTA'], axis=1).copy()
        
        # Divide by GP for per-game averages (skip FG% and FT% which are already percentages)
        for col in ['3PM', 'AST', 'REB', 'STL', 'BLK', 'PTS']:
            averages[col] = averages[col] / averages['GP']
        
        self.averages_df = averages.round(4)
        
        ranked = averages.copy()
        ranked.drop(['GP'], axis=1, inplace=True)
        ranked = ranked.rank()
        ranked['Total_Points'] = ranked.sum(axis=1)
        ranked.sort_values(by='Total_Points', ascending=False, inplace=True)
        
        ranked['Rank'] = ranked['Total_Points'].rank(method='min', ascending=False).astype(int)
        ranked.reset_index(inplace=True)  # This adds 'Team' as a column
        
        self.ranking_df = ranked
        return self.averages_df, self.ranking_df
    
    def get_rankings(self, sort_by: Optional[str] = None, order: str = "desc") -> LeagueRankings:
        """Get league rankings"""
        if self.ranking_df is None:
            self.process_data()
        
        df = self.ranking_df.copy()
        
        if sort_by and sort_by in df.columns:
            ascending = order == "asc"
            df = df.sort_values(sort_by, ascending=ascending)
        else:
            # Default sort by Total_Points (already sorted)
            pass
        
        rankings = []
        for idx, row in df.iterrows():
            ranking_stats = RankingStats(
                team=row['Team'],
                fg_percentage=float(row['FG%']) if 'FG%' in row else 0.0,
                ft_percentage=float(row['FT%']) if 'FT%' in row else 0.0,
                three_pm=float(row['3PM']) if '3PM' in row else 0.0,
                ast=float(row['AST']) if 'AST' in row else 0.0,
                reb=float(row['REB']) if 'REB' in row else 0.0,
                stl=float(row['STL']) if 'STL' in row else 0.0,
                blk=float(row['BLK']) if 'BLK' in row else 0.0,
                pts=float(row['PTS']) if 'PTS' in row else 0.0,
                total_points=float(row['Total_Points']),
                rank=int(row['Rank']) if 'Rank' in row else idx + 1
            )
            rankings.append(ranking_stats)
        
        return LeagueRankings(
            rankings=rankings,
            categories=['FG%', 'FT%', '3PM', 'AST', 'REB', 'STL', 'BLK', 'PTS', 'Total_Points'],
            last_updated=self.last_updated or datetime.now()
        )
    
    def get_category_rankings(self, category: str):
        """Get rankings for a specific category"""
        if self.averages_df is None:
            self.process_data()
        
        if category in self.averages_df.columns:
            df = self.averages_df.copy()
            return df.sort_values(category, ascending=False).to_dict('records')
        return {}
    
    def get_team_detail(self, team_name: str) -> TeamDetail:
        """Get detailed team statistics"""
        if self.raw_df is None or self.averages_df is None:
            self.process_data()
        
        if team_name not in self.raw_df.index:
            raise ValueError(f"Team '{team_name}' not found")
        
        raw_data = self.raw_df.loc[team_name]
        avg_data = self.averages_df.loc[team_name]
        
        # Create shot chart stats
        shot_chart = ShotChartStats(
            team=team_name,
            fgm=int(raw_data['FGM']),
            fga=int(raw_data['FGA']),
            fg_percentage=float(raw_data['FG%']),
            ftm=int(raw_data['FTM']),
            fta=int(raw_data['FTA']),
            ft_percentage=float(raw_data['FT%']),
            gp=int(raw_data['GP'])
        )
        
        # Create raw averages
        raw_averages = RawAverageStats(
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
        
        # Get ranking stats
        rank_data = self.ranking_df[self.ranking_df['Team'] == team_name].iloc[0]
        ranking_stats = RankingStats(
            team=team_name,
            fg_percentage=float(rank_data['FG%']),
            ft_percentage=float(rank_data['FT%']),
            three_pm=float(rank_data['3PM']),
            ast=float(rank_data['AST']),
            reb=float(rank_data['REB']),
            stl=float(rank_data['STL']),
            blk=float(rank_data['BLK']),
            pts=float(rank_data['PTS']),
            total_points=float(rank_data['Total_Points']),
            rank=int(rank_data['Rank'])
        )
        
        return TeamDetail(
            team=team_name,
            shot_chart=shot_chart,
            raw_averages=raw_averages,
            ranking_stats=ranking_stats,
            category_ranks={col: int(rank_data[col]) for col in ['FG%', 'FT%', '3PM', 'AST', 'REB', 'STL', 'BLK', 'PTS']}
        )
    
    def get_league_summary(self) -> LeagueSummary:
        """Get league summary statistics"""
        if self.averages_df is None or self.ranking_df is None:
            self.process_data()
        
        # Find category leaders
        leaders = {}
        for category in ['FG%', 'FT%', '3PM', 'AST', 'REB', 'STL', 'BLK', 'PTS']:
            best_team = self.averages_df[category].idxmax()
            best_value = self.averages_df.loc[best_team, category]
            
            leaders[f'{category}_leader'] = RankingStats(
                team=best_team,
                fg_percentage=float(self.averages_df.loc[best_team, 'FG%']),
                ft_percentage=float(self.averages_df.loc[best_team, 'FT%']),
                three_pm=float(self.averages_df.loc[best_team, '3PM']),
                ast=float(self.averages_df.loc[best_team, 'AST']),
                reb=float(self.averages_df.loc[best_team, 'REB']),
                stl=float(self.averages_df.loc[best_team, 'STL']),
                blk=float(self.averages_df.loc[best_team, 'BLK']),
                pts=float(self.averages_df.loc[best_team, 'PTS']),
                total_points=0.0
            )
        
        # Calculate league averages
        league_averages = RawAverageStats(
            team="League Average",
            fg_percentage=float(self.averages_df['FG%'].mean()),
            ft_percentage=float(self.averages_df['FT%'].mean()),
            three_pm=float(self.averages_df['3PM'].mean()),
            ast=float(self.averages_df['AST'].mean()),
            reb=float(self.averages_df['REB'].mean()),
            stl=float(self.averages_df['STL'].mean()),
            blk=float(self.averages_df['BLK'].mean()),
            pts=float(self.averages_df['PTS'].mean()),
            gp=int(self.averages_df['GP'].mean())
        )
        
        return LeagueSummary(
            total_teams=len(self.averages_df),
            total_games_played=int(self.averages_df['GP'].sum()),
            category_leaders=leaders,
            league_averages=league_averages,
            last_updated=self.last_updated or datetime.now()
        )
    
    def get_heatmap_data(self) -> HeatmapData:
        """Get data formatted for heatmap visualization"""
        if self.averages_df is None:
            self.process_data()
        
        categories = ['FG%', 'FT%', '3PM', 'AST', 'REB', 'STL', 'BLK', 'PTS']
        teams = self.averages_df.index.tolist()
        data = self.averages_df[categories].values.tolist()
        
        # Simple normalization (0-1 scale) without sklearn
        normalized_data = []
        for category in categories:
            col_data = self.averages_df[category]
            min_val, max_val = col_data.min(), col_data.max()
            if max_val - min_val > 0:
                normalized_col = ((col_data - min_val) / (max_val - min_val)).tolist()
            else:
                normalized_col = [0.5] * len(col_data)  # If all values are the same
            normalized_data.append(normalized_col)
        
        # Transpose to match expected format
        normalized_data = list(map(list, zip(*normalized_data)))
        
        return HeatmapData(
            teams=teams,
            categories=categories,
            data=data,
            normalized_data=normalized_data
        )
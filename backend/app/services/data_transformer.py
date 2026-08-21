import pandas as pd
import logging
from typing import Dict
from app.utils.constants import (
    ESPN_COLUMN_MAP, ALL_CATEGORIES, INTEGER_COLUMNS, PRO_TEAM_MAP, POSITION_MAP,
    RANKING_CATEGORIES
)
from app.services.stats_calculator import StatsCalculator
from app.config import settings
from app.utils.roster_slots import SLOT_CAPS
from app.utils.espn_stat_map import STAT_ID_TO_CATEGORY, NON_RANKING_STAT_KEYS


SLOT_MAP = {0: 'PG', 1: 'SG', 2: 'SF', 3: 'PF', 4: 'C', 5: 'G', 6: 'F', 11: 'UTIL'}


class DataTransformer:
    """Transforms raw ESPN data into clean pandas DataFrames"""

    def __init__(self):
        self.logger = logging.getLogger(__name__)
        self.stats_calculator = StatsCalculator()

    def resolve_ranking_categories(self, espn_data: Dict) -> list[str]:
        """Determine this league's actual scoring categories from ESPN's
        settings.scoringSettings.scoringItems (present when the standings
        request includes the mSettings view). Falls back to the historical
        fixed 8-category default (RANKING_CATEGORIES) whenever the settings
        are missing, unparseable, or don't map to any known category — this
        keeps behavior unchanged for the current league and for the DB
        fallback path, which is fixed to that same default schema."""
        try:
            scoring_items = espn_data.get('settings', {}).get('scoringSettings', {}).get('scoringItems', [])
            if not scoring_items:
                return list(RANKING_CATEGORIES)

            categories: list[str] = []
            for item in scoring_items:
                stat_id = item.get('statId')
                category = STAT_ID_TO_CATEGORY.get(stat_id)
                if category and category not in NON_RANKING_STAT_KEYS and category not in categories:
                    categories.append(category)

            return categories if categories else list(RANKING_CATEGORIES)
        except Exception as e:
            self.logger.warning(f"Error resolving ranking categories from ESPN settings, using default: {e}")
            return list(RANKING_CATEGORIES)

    def parse_slot_usage(self, espn_data: Dict) -> Dict[int, Dict[str, int]]:
        """Parse slot usage from mMatchupScore data. Returns {team_id: {slot_name: games_used}}"""
        result: Dict[int, Dict[str, int]] = {}
        try:
            schedule = espn_data.get('schedule', [])
            if not schedule:
                return result
            for matchup in schedule:
                for team in matchup.get('teams', []):
                    team_id = team.get('teamId')
                    stat_by_slot = team.get('cumulativeScore', {}).get('statBySlot', {})
                    if team_id is None or not stat_by_slot:
                        continue
                    if team_id not in result:
                        result[team_id] = {name: 0 for name in SLOT_CAPS}
                    for slot_id_str, slot_data in stat_by_slot.items():
                        slot_name = SLOT_MAP.get(int(slot_id_str))
                        if slot_name and slot_data.get('statId') == 42:
                            result[team_id][slot_name] = int(slot_data.get('value', 0))
        except Exception as e:
            self.logger.warning(f"Error parsing slot usage data: {e}")
        return result

    def raw_all_players_to_df(self, espn_data: Dict, stat_split_type_id: int = 0, fantasy_team_map: Dict[int, str] = None) -> pd.DataFrame:
        """
        Convert ESPN kona_player_info API data to DataFrame (all 500 players including FA/waivers)
        Args:
            espn_data: Raw ESPN API response with 'players' array
            stat_split_type_id: ESPN stat split type (0=season, 1=last7, 2=last15, 3=last30)
            fantasy_team_map: Optional dict mapping fantasy team_id -> team_name
        Returns:
            Clean DataFrame with proper columns and types, including status and injured fields
        """
        try:
            if not espn_data or 'players' not in espn_data:
                raise ValueError("Invalid ESPN players data structure")

            all_players = []
            for player_entry in espn_data.get('players', []):
                player = player_entry.get('player', {})
                status = player_entry.get('status', 'UNKNOWN')
                team_id = player_entry.get('onTeamId', 0)
                ratings = player_entry.get('ratings', {})

                player_name = player.get('fullName', 'Unknown')
                espn_player_id = player.get('id') or player_entry.get('id')
                pro_team_id = player.get('proTeamId', 0)
                pro_team = PRO_TEAM_MAP.get(pro_team_id, 'Unknown')
                injured = bool(player.get('injured', False))
                fantasy_team_name = (fantasy_team_map or {}).get(team_id)

                season_rating = ratings.get('0', {}).get('totalRating')
                last7_rating = ratings.get('1', {}).get('totalRating')
                last15_rating = ratings.get('2', {}).get('totalRating')
                last30_rating = ratings.get('3', {}).get('totalRating')

                positions = "Unknown"
                if 'eligibleSlots' in player:
                    slots = [POSITION_MAP.get(slot, '') for slot in player['eligibleSlots'] if 0 <= slot <= 4]
                    positions = ", ".join(filter(None, slots)) or "Unknown"

                stats = player.get('stats', [])
                for stat in stats:
                    if stat.get('scoringPeriodId') == 0 and stat.get('statSplitTypeId') == stat_split_type_id and stat.get('seasonId') == settings.season_id:
                        player_stats = stat.get('stats', {})
                        # ESPN tags this split with the current season before any games
                        # have been played, but leaves 'stats' empty — treat that as a
                        # real zero row (0 GP) rather than dropping the player, so the
                        # DataFrame always has every ESPN_COLUMN_MAP column.
                        mapped_stats: Dict[str, object] = {col: 0 for col in ESPN_COLUMN_MAP.values()}
                        mapped_stats.update({
                            ESPN_COLUMN_MAP[key]: value
                            for key, value in player_stats.items()
                            if key in ESPN_COLUMN_MAP
                        })

                        mapped_stats.update({
                            'Name': player_name,
                            'player_id': int(espn_player_id) if espn_player_id is not None else None,
                            'team_id': team_id,
                            'Pro Team': pro_team,
                            'Positions': positions,
                            'status': status,
                            'injured': injured,
                            'fantasy_team_name': fantasy_team_name,
                            'season_rating': season_rating,
                            'last7_rating': last7_rating,
                            'last15_rating': last15_rating,
                            'last30_rating': last30_rating,
                        })

                        all_players.append(mapped_stats)
                        break

            if not all_players:
                raise ValueError("No valid player data found")

            df = pd.DataFrame(all_players)
            # Keep player_id nulls intact (fillna(0) would create bogus /player/0 links).
            fill_cols = [c for c in df.columns if c != 'player_id']
            df[fill_cols] = df[fill_cols].fillna(0)
            return self._organize_player_columns(df)

        except Exception as e:
            self.logger.error(f"Error transforming ESPN players data to DataFrame: {e}")
            raise Exception("Error transforming ESPN players data to DataFrame")

    def raw_players_to_df(self, espn_players_data: Dict, stat_split_type_id: int = 0) -> pd.DataFrame:
        """
        Convert raw ESPN API players data to DataFrame
        Args:
            espn_players_data: Raw ESPN API response
            stat_split_type_id: ESPN stat split type (0=season, 1=last7, 2=last15, 3=last30)
        Returns:
            Clean DataFrame with proper columns and types
        """
        try:
            if not espn_players_data or 'teams' not in espn_players_data:
                raise ValueError("Invalid ESPN players data structure")
            
            all_players = []
            for team in espn_players_data['teams']:
                team_id = team['id']
                if 'roster' in team and 'entries' in team['roster']:
                    for entry in team['roster']['entries']:
                        player_stats = self._extract_player_stats(entry, team_id, stat_split_type_id)
                        if player_stats:  # Only add if we got valid stats
                            all_players.append(player_stats)
            
            if not all_players:
                raise ValueError("No valid player data found")
            df = pd.DataFrame(all_players)
            fill_cols = [c for c in df.columns if c != 'player_id']
            df[fill_cols] = df[fill_cols].fillna(0)
            return self._organize_player_columns(df)
            
        except Exception as e:
            self.logger.error(f"Error transforming ESPN players data to DataFrame: {e}")
            raise Exception("Error transforming ESPN players data to DataFrame")

    def raw_standings_to_team_names(self, espn_standings_data: Dict) -> list:
        """
        Extract just team_id/team_name from the same standings payload, independent
        of valuesByStat — team identity exists on ESPN's side even before any
        games are played, unlike per-team stat totals.
        """
        if not espn_standings_data or 'teams' not in espn_standings_data:
            return []
        return [
            {"team_id": team['id'], "team_name": team['name'].strip()}
            for team in espn_standings_data['teams']
            if 'id' in team and team.get('name')
        ]

    def raw_standings_to_totals_df(self, espn_standings_data: Dict, categories: list[str] = None) -> pd.DataFrame:
        """
        Convert raw ESPN API standings data to totals DataFrame
        Args:
            espn_standings_data: Raw ESPN API response
            categories: league's active ranking categories (defaults to RANKING_CATEGORIES).
                        Any category here beyond the fixed default set (e.g. TO) is kept
                        as an extra column if ESPN's payload carries a value for it.
        Returns:
            Clean totals DataFrame with proper columns and types
        """
        try:
            if not espn_standings_data or 'teams' not in espn_standings_data:
                raise ValueError("Invalid ESPN standings data structure")
            
            # Extract team data from ESPN response. ESPN omits valuesByStat
            # entirely before any games are played (preseason) — that's a real
            # zero-stat team, not a missing one, so synthesize zeros rather than
            # drop the team (same treatment as the players zero-row case).
            teams_data = []
            for team in espn_standings_data['teams']:
                if 'id' in team and 'name' in team:
                    values_by_stat = team.get('valuesByStat') or {key: 0 for key in ESPN_COLUMN_MAP}
                    team_data = {
                        "team_id": team['id'],
                        "team_name": team['name'].strip(),
                        **values_by_stat
                    }
                    teams_data.append(team_data)

            if not teams_data:
                raise ValueError("No valid team data found")
                
            df = pd.DataFrame(teams_data)
            return self._transform_standings_dataframe(df, categories)
            
        except Exception as e:
            self.logger.error(f"Error transforming ESPN standings data to totals DataFrame: {e}")
            raise Exception("Error transforming ESPN standings data to totals DataFrame")
    
    def totals_to_averages_df(self, totals_df: pd.DataFrame, categories: list[str] = None) -> pd.DataFrame:
        """
        Calculate per-game averages from totals DataFrame
        Args:
            totals_df: DataFrame with total stats
            categories: league's active ranking categories (defaults to RANKING_CATEGORIES)
        Returns:
            DataFrame with per-game averages
        """
        return self.stats_calculator.calculate_per_game_averages(totals_df, categories)
    
    def averages_to_rankings_df(self, averages_df: pd.DataFrame) -> pd.DataFrame:
        """
        Calculate rankings from averages DataFrame
        Args:
            averages_df: DataFrame with per-game averages
        Returns:
            DataFrame with rankings and total points
        """
        return self.stats_calculator.calculate_rankings(averages_df)
    
    def _extract_player_stats(self, entry: Dict, team_id: int, stat_split_type_id: int = 0) -> Dict:
        """Extract player stats from ESPN API data"""
        try:
            if 'playerPoolEntry' not in entry or 'player' not in entry['playerPoolEntry']:
                return {}

            player = entry['playerPoolEntry']['player']

            # Extract basic player info
            player_name = player.get('fullName', 'Unknown')
            espn_player_id = player.get('id') or entry.get('playerId')
            pro_team_id = player.get('proTeamId', 0)
            pro_team = PRO_TEAM_MAP.get(pro_team_id, 'Unknown')

            # Extract positions
            positions = "Unknown"
            if 'eligibleSlots' in player:
                slots = [POSITION_MAP.get(slot, '') for slot in player['eligibleSlots'] if 0 <= slot <= 4]
                positions = ", ".join(filter(None, slots)) or "Unknown"

            # Extract stats
            stats = player.get('stats', [])
            for stat in stats:
                if stat.get('scoringPeriodId') == 0 and stat.get('statSplitTypeId') == stat_split_type_id and stat.get('seasonId') == settings.season_id:
                    player_stats = stat.get('stats', {})
                    # Map ESPN column names to our names
                    mapped_stats = {
                        ESPN_COLUMN_MAP.get(key, key): value 
                        for key, value in player_stats.items() 
                        if key in ESPN_COLUMN_MAP
                    }
                    
                    # Add player info
                    mapped_stats.update({
                        'Name': player_name,
                        'player_id': int(espn_player_id) if espn_player_id is not None else None,
                        'team_id': team_id,
                        'Pro Team': pro_team,
                        'Positions': positions
                    })
                    
                    return mapped_stats
            
            return {}
            
        except Exception as e:
            self.logger.warning(f"Error extracting player stats: {e}")
            return {}
    
    def _organize_player_columns(self, df: pd.DataFrame) -> pd.DataFrame:
        """Organize player DataFrame columns in logical order"""
        info_cols = ['Name', 'player_id', 'team_id', 'Pro Team', 'Positions', 'status', 'injured', 'fantasy_team_name', 'season_rating', 'last7_rating', 'last15_rating', 'last30_rating']
        stat_cols = [col for col in df.columns if col not in info_cols]
        available_info_cols = [col for col in info_cols if col in df.columns]
        return df.reindex(columns=available_info_cols + stat_cols)
    
    def _transform_standings_dataframe(self, df: pd.DataFrame, categories: list[str] = None) -> pd.DataFrame:
        """
        Transform raw DataFrame with proper column names and types
        Args:
            df: Raw DataFrame from ESPN API
            categories: league's active ranking categories; any beyond the fixed
                        ALL_CATEGORIES default (e.g. TO) are kept as extra columns
                        when present, on top of the always-kept default set.
        Returns:
            Clean DataFrame with proper structure
        """
        # Apply column mapping
        df = df.rename(columns=ESPN_COLUMN_MAP)

        # Select only required columns (always the fixed default set, plus any
        # extra resolved categories beyond it)
        extra_cols = [c for c in (categories or []) if c not in ALL_CATEGORIES]
        available_cols = ['team_id', 'team_name'] + [col for col in ALL_CATEGORIES + extra_cols if col in df.columns]
        df = df[available_cols]
        
        # Convert integer columns
        int_cols = [col for col in INTEGER_COLUMNS if col in df.columns]
        df[int_cols] = df[int_cols].astype(int)
        
        return df

    
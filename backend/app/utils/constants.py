# ESPN API Constants and Mappings
from app.utils.espn_stat_map import STAT_ID_TO_CATEGORY

# ESPN stat lines (valuesByStat, player stats) key stats by the same numeric id
# as the scoring settings, as strings. Derived from the one id map rather than
# restated, so a category cannot be resolvable from league settings but
# unparseable from the stat line that carries its value.
ESPN_COLUMN_MAP = {str(stat_id): category for stat_id, category in STAT_ID_TO_CATEGORY.items()}

PRO_TEAM_MAP: dict[int, str] = {
    0: 'FA',
    1: 'ATL', 2: 'BOS',  3: 'NOP', 4: 'CHI',  5: 'CLE',
    6: 'DAL', 7: 'DEN',  8: 'DET', 9: 'GSW', 10: 'HOU',
    11: 'IND', 12: 'LAC', 13: 'LAL', 14: 'MIA', 15: 'MIL',
    16: 'MIN', 17: 'BKN', 18: 'NYK', 19: 'ORL', 20: 'PHL',
    21: 'PHO', 22: 'POR', 23: 'SAC', 24: 'SAS', 25: 'OKC',
    26: 'UTA', 27: 'WAS', 28: 'TOR', 29: 'MEM', 30: 'CHA',
}

NBA_TEAM_NAMES: dict[str, str] = {
    'ATL': 'Atlanta Hawks',          'BOS': 'Boston Celtics',
    'NOP': 'New Orleans Pelicans',   'CHI': 'Chicago Bulls',
    'CLE': 'Cleveland Cavaliers',    'DAL': 'Dallas Mavericks',
    'DEN': 'Denver Nuggets',         'DET': 'Detroit Pistons',
    'GSW': 'Golden State Warriors',  'HOU': 'Houston Rockets',
    'IND': 'Indiana Pacers',         'LAC': 'LA Clippers',
    'LAL': 'Los Angeles Lakers',     'MIA': 'Miami Heat',
    'MIL': 'Milwaukee Bucks',        'MIN': 'Minnesota Timberwolves',
    'BKN': 'Brooklyn Nets',          'NYK': 'New York Knicks',
    'ORL': 'Orlando Magic',          'PHL': 'Philadelphia 76ers',
    'PHO': 'Phoenix Suns',           'POR': 'Portland Trail Blazers',
    'SAC': 'Sacramento Kings',       'SAS': 'San Antonio Spurs',
    'OKC': 'Oklahoma City Thunder',  'UTA': 'Utah Jazz',
    'WAS': 'Washington Wizards',     'TOR': 'Toronto Raptors',
    'MEM': 'Memphis Grizzlies',      'CHA': 'Charlotte Hornets',
}

POSITION_MAP = {
    0: 'PG',
    1: 'SG',
    2: 'SF',
    3: 'PF',
    4: 'C'
}

# All stat categories in order
ALL_CATEGORIES = ['FGM', 'FGA', 'FG%', 'FTM', 'FTA', 'FT%', '3PM', 'AST', 'REB', 'STL', 'BLK', 'PTS', 'GP']

# Categories for ranking (excludes raw counting stats)
RANKING_CATEGORIES = ['FG%', 'FT%', '3PM', 'AST', 'REB', 'STL', 'BLK', 'PTS']

# Per-game average categories (excludes percentages and GP)
PER_GAME_CATEGORIES = ['3PM', 'AST', 'REB', 'STL', 'BLK', 'PTS']

# Integer columns for type conversion
INTEGER_COLUMNS = ['FGM', 'FGA', 'FTM', 'FTA', '3PM', 'AST', 'REB', 'STL', 'BLK', 'PTS', 'GP']

# Categories that are a quotient of two other stats, and the (numerator,
# denominator) pair each is built from. A quotient cannot be summed, divided by
# games played, or differenced between two cumulative snapshots -- doing any of
# those to a rate gives a number that means nothing -- so it is always rebuilt
# from its sources over whatever window is being computed.
#
# Per-game categories (PPG, RPG, ...) are quotients too, over GP, and are listed
# here for exactly that reason: a league scoring PPG must not have it divided by
# GP a second time.
RATIO_CATEGORIES: dict[str, tuple[str, str]] = {
    'FG%': ('FGM', 'FGA'),
    'FT%': ('FTM', 'FTA'),
    '3P%': ('3PM', '3PA'),
    'A/TO': ('AST', 'TO'),
    'FTR': ('FTA', 'FGA'),
    'PPM': ('PTS', 'MIN'),
    'PPG': ('PTS', 'GP'),
    'RPG': ('REB', 'GP'),
    'APG': ('AST', 'GP'),
    'BPG': ('BLK', 'GP'),
    'SPG': ('STL', 'GP'),
    'TOPG': ('TO', 'GP'),
    '3PG': ('3PM', 'GP'),
    'MPG': ('MIN', 'GP'),
}

# Categories that are derived rather than counted, and so are never divided by
# games played. Named PERCENTAGE_CATEGORIES when FG% and FT% were the only two.
DERIVED_CATEGORIES = frozenset(RATIO_CATEGORIES)
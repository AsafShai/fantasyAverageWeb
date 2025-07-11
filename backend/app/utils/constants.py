# ESPN API Constants and Mappings

# ESPN API column mapping
ESPN_COLUMN_MAP = {
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

PRO_TEAM_MAP = {
    0: 'FA',
    1: 'ATL',
    2: 'BOS',
    3: 'NOP',
    4: 'CHI',
    5: 'CLE',
    6: 'DAL',
    7: 'DEN',
    8: 'DET',
    9: 'GSW',
    10: 'HOU',
    11: 'IND',
    12: 'LAC',
    13: 'LAL',
    14: 'MIA',
    15: 'MIL',
    16: 'MIN',
    17: 'BKN',
    18: 'NYK',
    19: 'ORL',
    20: 'PHL',
    21: 'PHO',
    22: 'POR',
    23: 'SAC',
    24: 'SAS',
    25: 'OKC',
    26: 'UTA',
    27: 'WAS',
    28: 'TOR',
    29: 'MEM',
    30: 'CHA'
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
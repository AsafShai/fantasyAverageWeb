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

# All stat categories in order
ALL_CATEGORIES = ['FGM', 'FGA', 'FG%', 'FTM', 'FTA', 'FT%', '3PM', 'AST', 'REB', 'STL', 'BLK', 'PTS', 'GP']

# Categories for ranking (excludes raw counting stats)
RANKING_CATEGORIES = ['FG%', 'FT%', '3PM', 'AST', 'REB', 'STL', 'BLK', 'PTS']

# Per-game average categories (excludes percentages and GP)
PER_GAME_CATEGORIES = ['3PM', 'AST', 'REB', 'STL', 'BLK', 'PTS']

# Integer columns for type conversion
INTEGER_COLUMNS = ['FGM', 'FGA', 'FTM', 'FTA', '3PM', 'AST', 'REB', 'STL', 'BLK', 'PTS', 'GP'] 
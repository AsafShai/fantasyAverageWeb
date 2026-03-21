# ESPN API Constants and Mappings

NBA_TEAMS: list[dict] = [
    {"team_id": "1",  "team_name": "Atlanta Hawks",          "abbreviation": "ATL"},
    {"team_id": "2",  "team_name": "Boston Celtics",         "abbreviation": "BOS"},
    {"team_id": "3",  "team_name": "New Orleans Pelicans",   "abbreviation": "NOP"},
    {"team_id": "4",  "team_name": "Chicago Bulls",          "abbreviation": "CHI"},
    {"team_id": "5",  "team_name": "Cleveland Cavaliers",    "abbreviation": "CLE"},
    {"team_id": "6",  "team_name": "Dallas Mavericks",       "abbreviation": "DAL"},
    {"team_id": "7",  "team_name": "Denver Nuggets",         "abbreviation": "DEN"},
    {"team_id": "8",  "team_name": "Detroit Pistons",        "abbreviation": "DET"},
    {"team_id": "9",  "team_name": "Golden State Warriors",  "abbreviation": "GSW"},
    {"team_id": "10", "team_name": "Houston Rockets",        "abbreviation": "HOU"},
    {"team_id": "11", "team_name": "Indiana Pacers",         "abbreviation": "IND"},
    {"team_id": "12", "team_name": "LA Clippers",            "abbreviation": "LAC"},
    {"team_id": "13", "team_name": "Los Angeles Lakers",     "abbreviation": "LAL"},
    {"team_id": "14", "team_name": "Miami Heat",             "abbreviation": "MIA"},
    {"team_id": "15", "team_name": "Milwaukee Bucks",        "abbreviation": "MIL"},
    {"team_id": "16", "team_name": "Minnesota Timberwolves", "abbreviation": "MIN"},
    {"team_id": "17", "team_name": "Brooklyn Nets",          "abbreviation": "BKN"},
    {"team_id": "18", "team_name": "New York Knicks",        "abbreviation": "NYK"},
    {"team_id": "19", "team_name": "Orlando Magic",          "abbreviation": "ORL"},
    {"team_id": "20", "team_name": "Philadelphia 76ers",     "abbreviation": "PHI"},
    {"team_id": "21", "team_name": "Phoenix Suns",           "abbreviation": "PHX"},
    {"team_id": "22", "team_name": "Portland Trail Blazers", "abbreviation": "POR"},
    {"team_id": "23", "team_name": "Sacramento Kings",       "abbreviation": "SAC"},
    {"team_id": "24", "team_name": "San Antonio Spurs",      "abbreviation": "SAS"},
    {"team_id": "25", "team_name": "Oklahoma City Thunder",  "abbreviation": "OKC"},
    {"team_id": "26", "team_name": "Utah Jazz",              "abbreviation": "UTA"},
    {"team_id": "29", "team_name": "Memphis Grizzlies",      "abbreviation": "MEM"},
    {"team_id": "28", "team_name": "Toronto Raptors",        "abbreviation": "TOR"},
    {"team_id": "30", "team_name": "Charlotte Hornets",      "abbreviation": "CHA"},
    {"team_id": "27", "team_name": "Washington Wizards",     "abbreviation": "WAS"},
]

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
    '42': 'GP',
    '40': 'MIN'
}

PRO_TEAM_MAP: dict[int, str] = {0: 'FA', **{int(t['team_id']): t['abbreviation'] for t in NBA_TEAMS}}

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
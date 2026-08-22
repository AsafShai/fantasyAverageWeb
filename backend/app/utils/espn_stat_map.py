"""Maps ESPN's numeric fantasy basketball statId -> our category code.

ESPN identifies every stat category by a small numeric id (see
https://github.com/cwendt94/espn-api conventions, and
app.utils.constants.ESPN_COLUMN_MAP for the subset we already parse from
player/team stat lines). This is the same id space, extended with a few
common categories leagues sometimes score on but this app hasn't needed
yet (e.g. turnovers).

Categories NOT eligible to be "ranking" categories (raw counting stats
that feed a percentage, or non-competitive stats like games/minutes
played) are listed in NON_RANKING_STAT_KEYS and filtered out by
resolve_ranking_categories regardless of whether ESPN's league settings
include them.
"""

STAT_ID_TO_CATEGORY: dict[int, str] = {
    0: 'PTS',
    1: 'BLK',
    2: 'STL',
    3: 'AST',
    6: 'REB',
    11: 'TO',
    13: 'FGM',
    14: 'FGA',
    15: 'FTM',
    16: 'FTA',
    17: '3PM',
    19: 'FG%',
    20: 'FT%',
    42: 'GP',
    40: 'MIN',
}

NON_RANKING_STAT_KEYS: frozenset[str] = frozenset({'FGM', 'FGA', 'FTM', 'FTA', 'GP', 'MIN'})

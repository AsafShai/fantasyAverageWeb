"""Maps ESPN's numeric fantasy basketball statId -> our category code.

ESPN identifies every stat category by a small numeric id. The full id space is
mapped here, not just the categories this app has needed, so a league scoring
anything ESPN offers resolves without a code change. Ids are taken from the
espn-api library's basketball STATS_MAP, the same source this file has always
cited (https://github.com/cwendt94/espn-api). Id 45 is a placeholder there with
no stat behind it and is deliberately absent.

Mapping an id is only half of supporting a category. Three further facts decide
whether a resolved category can actually be computed:

- NON_RANKING_STAT_KEYS -- raw quantities that feed a derived category (FGA,
  3PA) or describe participation (GP, MIN). Never scored on their own, but kept
  in the frame because derived categories are rebuilt from them.
- constants.RATIO_CATEGORIES -- categories that are a quotient of two others.
  They cannot be summed, averaged per game, or differenced between cumulative
  snapshots, so every consumer has to rebuild them from their sources.
- UNSUPPORTED_CATEGORIES -- mapped, and ESPN may well score them, but this app
  has no way to compute them from what it stores. Resolving one logs a warning
  rather than silently dropping it.
"""
STAT_ID_TO_CATEGORY: dict[int, str] = {
    0: 'PTS',
    1: 'BLK',
    2: 'STL',
    3: 'AST',
    4: 'OREB',
    5: 'DREB',
    6: 'REB',
    7: 'EJ',
    8: 'FF',
    9: 'PF',
    10: 'TF',
    11: 'TO',
    12: 'DQ',
    13: 'FGM',
    14: 'FGA',
    15: 'FTM',
    16: 'FTA',
    17: '3PM',
    18: '3PA',
    19: 'FG%',
    20: 'FT%',
    21: '3P%',
    22: 'AFG%',
    23: 'FGMI',
    24: 'FTMI',
    25: '3PMI',
    26: 'APG',
    27: 'BPG',
    28: 'MPG',
    29: 'PPG',
    30: 'RPG',
    31: 'SPG',
    32: 'TOPG',
    33: '3PG',
    34: 'PPM',
    35: 'A/TO',
    36: 'STR',
    37: 'DD',
    38: 'TD',
    39: 'QD',
    40: 'MIN',
    41: 'GS',
    42: 'GP',
    43: 'TW',
    44: 'FTR',
}

NON_RANKING_STAT_KEYS: frozenset[str] = frozenset({
    'FGM', 'FGA', 'FTM', 'FTA', '3PA', 'GP', 'MIN',
})

# Mapped but not computable from what this app stores. AFG% is a weighted
# formula rather than a quotient of two stored quantities, and STR (streak) is
# not a stat at all.
UNSUPPORTED_CATEGORIES: frozenset[str] = frozenset({'AFG%', 'STR'})


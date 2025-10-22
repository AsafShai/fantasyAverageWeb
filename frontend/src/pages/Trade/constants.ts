// Constants for Trade analyzer

export const STAT_LABELS = {
  PTS: 'PTS',
  REB: 'REB',
  AST: 'AST',
  STL: 'STL',
  BLK: 'BLK',
  THREE_PM: '3PM',
  FGM: 'FGM',
  FGA: 'FGA',
  FG_PERCENTAGE: 'FG%',
  FTM: 'FTM',
  FTA: 'FTA',
  FT_PERCENTAGE: 'FT%',
  GP: 'GP',
} as const;

export const STAT_ICONS = {
  PTS: '🏀',
  REB: '🏀',
  AST: '🤝',
  STL: '🥷',
  BLK: '🛡️',
  THREE_PM: '🎯',
  FGM: '🎯',
  FGA: '🏹',
  FG_PERCENTAGE: '📈',
  FTM: '🆓',
  FTA: '🎯',
  FT_PERCENTAGE: '📊',
  GP: '📅',
} as const;

export const STAT_KEYS = [
  'minutes',
  'fgm',
  'fga',
  'fg_percentage',
  'ftm',
  'fta',
  'ft_percentage',
  'three_pm',
  'reb',
  'ast',
  'stl',
  'blk',
  'pts',
  'gp',
] as const;

export const GRID_BREAKPOINTS = {
  SM: 'sm:grid-cols-4',
  MD: 'md:grid-cols-6',
  LG: 'lg:grid-cols-8',
  XL: 'xl:grid-cols-10',
  '2XL': '2xl:grid-cols-14',
} as const;

export const DECIMAL_PLACES = {
  PERCENTAGE: 4,
  REGULAR: 4,
  TOTALS: 0,
} as const;
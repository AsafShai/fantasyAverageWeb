import type { BoxTeamTotals } from '../../types/boxScore'

export const BOX_LINE_COLUMNS: { key: keyof BoxTeamTotals; label: string }[] = [
  { key: 'min', label: 'MIN' },
  { key: 'pts', label: 'PTS' },
  { key: 'fg', label: 'FG' },
  { key: 'fg3', label: '3PT' },
  { key: 'ft', label: 'FT' },
  { key: 'reb', label: 'REB' },
  { key: 'ast', label: 'AST' },
  { key: 'tov', label: 'TO' },
  { key: 'stl', label: 'STL' },
  { key: 'blk', label: 'BLK' },
  { key: 'oreb', label: 'OREB' },
  { key: 'dreb', label: 'DREB' },
  { key: 'pf', label: 'PF' },
  { key: 'plus_minus', label: '+/−' },
]

import type { PlayerSeasonLine } from '../types/api'

/** Columns of the "Previous seasons" table, shared by desktop and phone. */
export const PAST_SEASON_COLS: {
  key: string
  label: string
  value: (s: PlayerSeasonLine) => string
}[] = [
  { key: 'gp', label: 'GP', value: (s) => String(s.gp) },
  { key: 'min', label: 'MIN', value: (s) => fmt(s.minutes) },
  { key: 'fg', label: 'FG', value: (s) => `${fmt(s.fgm)}-${fmt(s.fga)}` },
  { key: 'fgp', label: 'FG%', value: (s) => pct(s.fg_percentage) },
  { key: 'ft', label: 'FT', value: (s) => `${fmt(s.ftm)}-${fmt(s.fta)}` },
  { key: 'ftp', label: 'FT%', value: (s) => pct(s.ft_percentage) },
  { key: '3pm', label: '3PM', value: (s) => fmt(s.three_pm) },
  { key: 'reb', label: 'REB', value: (s) => fmt(s.reb) },
  { key: 'ast', label: 'AST', value: (s) => fmt(s.ast) },
  { key: 'stl', label: 'STL', value: (s) => fmt(s.stl) },
  { key: 'blk', label: 'BLK', value: (s) => fmt(s.blk) },
  { key: 'to', label: 'TO', value: (s) => fmt(s.to) },
  { key: 'pts', label: 'PTS', value: (s) => fmt(s.pts) },
]

function fmt(v: number | null): string {
  return v == null ? '—' : v.toFixed(1)
}

function pct(v: number | null): string {
  return v == null ? '—' : `${(v * 100).toFixed(1)}%`
}

/** "2024-25" → "'24-25". */
export function shortSeasonLabel(s: PlayerSeasonLine): string {
  const m = /^(\d{4})-(\d{2})$/.exec(s.season_label)
  return m ? `'${m[1].slice(2)}-${m[2]}` : s.season_label
}

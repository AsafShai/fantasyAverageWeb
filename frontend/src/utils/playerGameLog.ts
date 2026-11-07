import type { PlayerGameLogGame } from '../types/api'

// Columns and formatting for a player's game log (profile, phone and desktop).

export const COUNT_COLS: { key: 'minutes' | 'pts' | 'reb' | 'ast' | 'stl' | 'blk' | 'tov' | 'plus_minus'; label: string; strong?: boolean; signed?: boolean }[] = [
  { key: 'minutes', label: 'MIN' },
  { key: 'pts', label: 'PTS', strong: true },
  { key: 'reb', label: 'REB' },
  { key: 'ast', label: 'AST' },
  { key: 'stl', label: 'STL' },
  { key: 'blk', label: 'BLK' },
  { key: 'tov', label: 'TO' },
  { key: 'plus_minus', label: '+/−', signed: true },
]

export const SHOT_COLS: { made: 'fgm' | 'fg3m' | 'ftm'; att: 'fga' | 'fg3a' | 'fta'; label: string }[] = [
  { made: 'fgm', att: 'fga', label: 'FG' },
  { made: 'fg3m', att: 'fg3a', label: '3P' },
  { made: 'ftm', att: 'fta', label: 'FT' },
]

export function whole(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

export function signed(n: number): string {
  const text = whole(n)
  return n > 0 ? `+${text}` : text
}

export function shotLine(made: number, att: number): string {
  return `${whole(made)}-${whole(att)}`
}

export function shotPct(made: number, att: number): string {
  if (att <= 0) return '—'
  return `${((made / att) * 100).toFixed(1)}%`
}

export function mean(games: PlayerGameLogGame[], key: (typeof COUNT_COLS)[number]['key']): string {
  if (games.length === 0) return '—'
  const value = games.reduce((sum, game) => sum + game[key], 0) / games.length
  return key === 'plus_minus' ? signed(Number(value.toFixed(1))) : value.toFixed(1)
}

export function record(games: PlayerGameLogGame[]): string {
  let wins = 0
  let losses = 0
  for (const game of games) {
    if (game.team_pts == null || game.opp_pts == null || game.team_pts === game.opp_pts) continue
    if (game.team_pts > game.opp_pts) wins += 1
    else losses += 1
  }
  if (wins + losses === 0) return '—'
  return `${wins}–${losses}`
}

export function logDate(iso: string): { weekday: string; day: string } {
  const date = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(date.getTime())) return { weekday: '', day: iso }
  return {
    weekday: date.toLocaleDateString(undefined, { weekday: 'short' }),
    day: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
  }
}

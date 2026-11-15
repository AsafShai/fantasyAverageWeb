import type { GameLogNightLine, PlayerGameLogGame, PlayerGameLogResponse } from '../types/api'
import type { SlateLine, SlateValues } from '../types/boxScore'
import { slatePlayerValues } from '../components/boxScores/slateValues'

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

function slateLine(line: GameLogNightLine): SlateLine {
  return {
    player_id: line.player_id,
    name: line.name,
    position: line.position,
    team_abbr: '',
    team_logo: '',
    opponent_abbr: '',
    is_home: false,
    game_id: line.game_id,
    game_status: 'final',
    min: '',
    pts: '',
    reb: '',
    ast: '',
    stl: '',
    blk: '',
    tov: '',
    fg: '',
    fg3: '',
    ft: '',
    stats: line.stats,
    fantasy_team: null,
    fantasy_team_name: null,
    lineup_slot: null,
    started: null,
  }
}

/**
 * This player's box-score Z for each of his games: the Player Rankings value
 * of everyone who logged minutes that night, the same number the box score shows.
 */
export function zByGame(data: PlayerGameLogResponse | undefined): Map<string, number> {
  const map = new Map<string, number>()
  if (!data?.nights?.length || !data.categories?.length) return map
  const playerId = String(data.player_id)
  for (const night of data.nights) {
    const values: SlateValues = {
      date: night.date,
      complete: true,
      games_counted: night.players.length,
      categories: data.categories,
      reverse_categories: data.reverse_categories ?? [],
      players: night.players.map(slateLine),
    }
    for (const line of slatePlayerValues(values)) {
      if (line.player_id === playerId) map.set(line.game_id, line.z)
    }
  }
  return map
}

/** Mean of the Zs this player has for these games, or null when none were scored. */
export function averageZ(games: { game_id: string }[], zs: Map<string, number>): number | null {
  const known = games.map((game) => zs.get(game.game_id)).filter((z): z is number => z != null)
  if (known.length === 0) return null
  return known.reduce((sum, z) => sum + z, 0) / known.length
}

export type GameLogSortKey = 'date' | 'opp' | 'z' | (typeof COUNT_COLS)[number]['key'] | (typeof SHOT_COLS)[number]['label']

export interface GameLogSort {
  key: GameLogSortKey
  dir: 'asc' | 'desc'
}

export const GAME_LOG_SORT_DEFAULT: GameLogSort = { key: 'date', dir: 'desc' }

/** First click on a stat is high → low. Opponent starts A → Z. Date starts newest first. */
export function toggleGameLogSort(current: GameLogSort, key: GameLogSortKey): GameLogSort {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { key, dir: key === 'opp' ? 'asc' : 'desc' }
}

function shotRate(game: PlayerGameLogGame, label: (typeof SHOT_COLS)[number]['label']): number | null {
  const col = SHOT_COLS.find((shot) => shot.label === label)
  if (!col || game[col.att] <= 0) return null
  return game[col.made] / game[col.att]
}

function countKey(key: GameLogSortKey): key is (typeof COUNT_COLS)[number]['key'] {
  return COUNT_COLS.some((col) => col.key === key)
}

function sortValue(game: PlayerGameLogGame, key: GameLogSortKey, zs: Map<string, number>): number | string | null {
  if (key === 'date') return game.game_date
  if (key === 'opp') return game.opponent
  if (key === 'z') return zs.get(game.game_id) ?? null
  if (key === 'FG' || key === '3P' || key === 'FT') return shotRate(game, key)
  if (countKey(key)) return game[key]
  return null
}

/**
 * Sort a season's games. A missing Z, or a shooting line with no attempts,
 * stays at the bottom either way. Equal values keep the newer game first.
 */
export function sortGameLog(games: PlayerGameLogGame[], zs: Map<string, number>, sort: GameLogSort): PlayerGameLogGame[] {
  const sign = sort.dir === 'asc' ? 1 : -1
  return [...games].sort((a, b) => {
    const av = sortValue(a, sort.key, zs)
    const bv = sortValue(b, sort.key, zs)
    if (av == null || bv == null) {
      if (av == null && bv == null) return b.game_date.localeCompare(a.game_date) || b.game_id.localeCompare(a.game_id)
      return av == null ? 1 : -1
    }
    const cmp = typeof av === 'string' && typeof bv === 'string' ? av.localeCompare(bv) : Number(av) - Number(bv)
    if (cmp !== 0) return cmp * sign
    return b.game_date.localeCompare(a.game_date) || b.game_id.localeCompare(a.game_id)
  })
}

export function logDate(iso: string): { weekday: string; day: string } {
  const date = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(date.getTime())) return { weekday: '', day: iso }
  return {
    weekday: date.toLocaleDateString(undefined, { weekday: 'short' }),
    day: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
  }
}

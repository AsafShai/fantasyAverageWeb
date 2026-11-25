import type { ScheduleGame, ScheduleTeam, TeamGameResult } from '../types/api'

// Schedule dates are NBA (Eastern) calendar days.
export function easternToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
}

export function formatScheduleDate(date: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-US', options).format(new Date(`${date}T12:00:00`))
}

export function monthKey(date: string): string {
  return date.slice(0, 7)
}

export function monthLabel(date: string): string {
  return formatScheduleDate(`${date.slice(0, 7)}-01`, { month: 'long', year: 'numeric' })
}

/** Slate-size shading level: 2 = 12+ games, 1 = high volume, 0 = ordinary. */
export function slateLevel(game: ScheduleGame): 0 | 1 | 2 {
  if (game.slate_size >= 12) return 2
  if (game.high_volume || game.slate_size >= 10) return 1
  return 0
}

export type ScheduleView = 'results' | 'upcoming' | 'all'

/** One schedule row: the game, and its final score once it has been played. */
export interface ScheduleRow {
  game: ScheduleGame
  result?: TeamGameResult
  /** Over: it has a final score, or its day has passed. */
  played: boolean
}

export interface ScheduleRecord {
  record: string
  home: string
  away: string
  last10: string
}

/** Joins the season schedule with the team's final scores, by game id (else date and opponent). */
export function scheduleRows(team: ScheduleTeam, results: readonly TeamGameResult[] = [], today = easternToday()): ScheduleRow[] {
  const byId = new Map(results.map(result => [result.game_id, result]))
  const byDay = new Map(results.map(result => [`${result.date}:${result.opponent_id}`, result]))
  return team.games.map(game => {
    const result = byId.get(game.game_id) ?? byDay.get(`${game.date}:${game.opponent_id}`)
    return { game, result, played: Boolean(result) || game.date < today }
  })
}

/** The rows a view shows: Results = played, Upcoming = still to play, All = the season, all in date order. */
export function rowsForView(rows: readonly ScheduleRow[], view: ScheduleView): ScheduleRow[] {
  if (view === 'results') return rows.filter(row => row.played)
  if (view === 'upcoming') return rows.filter(row => !row.played)
  return [...rows]
}

function winLoss(results: readonly TeamGameResult[]): string {
  const wins = results.filter(result => result.won).length
  return `${wins}-${results.length - wins}`
}

export function seasonRecord(results: readonly TeamGameResult[]): ScheduleRecord {
  return {
    record: winLoss(results),
    home: winLoss(results.filter(result => result.is_home)),
    away: winLoss(results.filter(result => !result.is_home)),
    last10: winLoss(results.slice(-10)),
  }
}

/** Box score page for a played game. */
export function boxScoreHref(game: ScheduleGame): string {
  return `/box-scores?date=${game.date}&game=${encodeURIComponent(game.game_id)}`
}

/**
 * Where a view's scroll box should open: Results at the latest game, All with
 * a few results above today's line, Upcoming at the top. `rows` are the box's
 * rows in order; `today` is the index of the first row still to play.
 */
export function initialScrollTarget(view: ScheduleView, rowCount: number, today: number, resultsAbove = 3): 'top' | 'bottom' | number {
  if (view === 'results') return 'bottom'
  if (view === 'all' && today > 0 && today < rowCount) return Math.max(0, today - resultsAbove)
  if (view === 'all' && today >= rowCount && rowCount > 0) return 'bottom'
  return 'top'
}

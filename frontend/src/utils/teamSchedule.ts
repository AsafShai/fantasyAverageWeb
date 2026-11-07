import type { ScheduleGame, ScheduleTeam } from '../types/api'

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

/** Only what is left: games before today drop out of the table and the counts. */
export function remainingSchedule(team: ScheduleTeam, today = easternToday()) {
  const games = team.games.filter(game => game.date >= today)
  return {
    games,
    b2bLeft: games.filter(game => game.rest_days === 0).length,
    highVolumeLeft: games.filter(game => game.high_volume).length,
  }
}

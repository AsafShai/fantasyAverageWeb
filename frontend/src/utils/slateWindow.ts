import type { ScheduleCalendarDay, ScheduleResponse } from '../types/api'

export const HIGH_VOLUME_GAMES = 10

export interface SlateMatchup {
  away: string
  home: string
}

export interface SlateDay {
  date: string
  slateSize: number
  highVolume: boolean
  matchups: SlateMatchup[]
}

export interface SlateTeamRow {
  abbreviation: string
  teamName: string
  plays: boolean[]
  games: number
  b2b: number
  nextIndex: number
  delta: number
}

export interface SlateWindow {
  days: SlateDay[]
  rows: SlateTeamRow[]
  modalGames: number
  minGames: number
  maxGames: number
  ordinaryTeams: number
  totalGames: number
  highVolumeNights: number
  darkNights: number
}

/** Today as ESPN dates games: the US Eastern calendar day, not the viewer's.
 *  toISOString() would give the UTC day, which is already tomorrow between
 *  7pm and midnight ET — that dropped the in-progress slate from the window. */
export function easternToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
}

export function firstScheduleDay(days: ScheduleCalendarDay[]): string {
  const today = easternToday()
  return days.find(day => day.date >= today)?.date ?? days[0]?.date ?? ''
}

export function formatSlateDate(date: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-US', options).format(new Date(`${date}T12:00:00`))
}

export function addDays(date: string, amount: number): string {
  const next = new Date(`${date}T12:00:00`)
  next.setDate(next.getDate() + amount)
  return next.toISOString().slice(0, 10)
}

/** Monday-start week key, matching how fantasy weeks are usually drawn. */
export function weekStart(date: string): string {
  const value = new Date(`${date}T12:00:00`)
  const mondayOffset = (value.getDay() + 6) % 7
  value.setDate(value.getDate() - mondayOffset)
  return value.toISOString().slice(0, 10)
}

export function matchupsByDate(schedule: ScheduleResponse): Map<string, SlateMatchup[]> {
  const byDate = new Map<string, SlateMatchup[]>()
  const seen = new Set<string>()
  for (const team of schedule.teams) {
    for (const game of team.games) {
      if (seen.has(game.game_id)) continue
      seen.add(game.game_id)
      const matchup: SlateMatchup = game.is_home
        ? { away: game.opponent_abbreviation, home: team.abbreviation }
        : { away: team.abbreviation, home: game.opponent_abbreviation }
      const existing = byDate.get(game.date)
      if (existing) existing.push(matchup)
      else byDate.set(game.date, [matchup])
    }
  }
  for (const matchups of byDate.values()) {
    matchups.sort((a, b) => a.away.localeCompare(b.away))
  }
  return byDate
}

export function buildSlateWindow(
  schedule: ScheduleResponse,
  startDate: string,
  endDate: string,
  matchups: Map<string, SlateMatchup[]>
): SlateWindow {
  const days: SlateDay[] = schedule.calendar_days
    .filter(day => day.date >= startDate && day.date <= endDate)
    .map(day => ({
      date: day.date,
      slateSize: day.slate_size,
      highVolume: day.high_volume,
      matchups: matchups.get(day.date) ?? [],
    }))

  const dayIndex = new Map(days.map((day, index) => [day.date, index]))
  const rows: SlateTeamRow[] = schedule.teams.map(team => {
    const plays = new Array<boolean>(days.length).fill(false)
    for (const game of team.games) {
      const index = dayIndex.get(game.date)
      if (index !== undefined) plays[index] = true
    }
    let games = 0
    let b2b = 0
    let nextIndex = -1
    plays.forEach((playing, index) => {
      if (!playing) return
      games += 1
      if (index > 0 && plays[index - 1]) b2b += 1
      if (nextIndex === -1) nextIndex = index
    })
    return {
      abbreviation: team.abbreviation,
      teamName: team.team_name,
      plays,
      games,
      b2b,
      nextIndex,
      delta: 0,
    }
  })

  const counts = new Map<number, number>()
  for (const row of rows) counts.set(row.games, (counts.get(row.games) ?? 0) + 1)
  let modalGames = 0
  let ordinaryTeams = 0
  for (const [value, count] of counts) {
    if (count > ordinaryTeams || (count === ordinaryTeams && value > modalGames)) {
      modalGames = value
      ordinaryTeams = count
    }
  }
  for (const row of rows) row.delta = row.games - modalGames

  const gameCounts = rows.map(row => row.games)
  return {
    days,
    rows,
    modalGames,
    ordinaryTeams,
    minGames: gameCounts.length ? Math.min(...gameCounts) : 0,
    maxGames: gameCounts.length ? Math.max(...gameCounts) : 0,
    totalGames: days.reduce((sum, day) => sum + day.slateSize, 0),
    highVolumeNights: days.filter(day => day.slateSize >= HIGH_VOLUME_GAMES).length,
    darkNights: days.filter(day => day.slateSize === 0).length,
  }
}

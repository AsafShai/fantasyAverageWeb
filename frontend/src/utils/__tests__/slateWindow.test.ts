import { describe, expect, it } from 'vitest'
import type { ScheduleGame, ScheduleResponse, ScheduleTeam } from '../../types/api'
import { opponentsByTeamDate, weekGameCount, weekOpponent, weekScheduleDays } from '../slateWindow'

function game(partial: Pick<ScheduleGame, 'date' | 'opponent_abbreviation' | 'is_home'> & { game_id?: string }): ScheduleGame {
  return {
    game_id: partial.game_id ?? `${partial.date}-${partial.opponent_abbreviation}`,
    date: partial.date,
    opponent_id: 1,
    opponent: partial.opponent_abbreviation,
    opponent_abbreviation: partial.opponent_abbreviation,
    is_home: partial.is_home,
    rest_days: null,
    slate_size: 1,
    high_volume: false,
  }
}

function team(abbreviation: string, games: ScheduleGame[]): ScheduleTeam {
  return {
    team_id: abbreviation.charCodeAt(0),
    abbreviation,
    team_name: abbreviation,
    games,
    monthly_games: {},
    total_games: games.length,
    b2b_count: 0,
    high_volume_games: 0,
    avg_rest_days: null,
  }
}

function schedule(teams: ScheduleTeam[]): ScheduleResponse {
  return {
    season: '2026-27',
    high_volume_threshold: 10,
    calendar_days: [],
    teams,
    published_games_min: 1,
    published_games_max: 1,
  }
}

describe('weekScheduleDays', () => {
  it('covers today and the next six days', () => {
    const days = weekScheduleDays('2026-10-18')
    expect(days).toHaveLength(7)
    expect(days[0]).toMatchObject({ date: '2026-10-18', weekday: 'Sun', label: 'Oct 18' })
    expect(days[6]).toMatchObject({ date: '2026-10-24', weekday: 'Sat', label: 'Oct 24' })
  })

  it('extends through the requested number of days', () => {
    const days = weekScheduleDays('2026-10-18', 14)
    expect(days).toHaveLength(14)
    expect(days[13]).toMatchObject({ date: '2026-10-31', weekday: 'Sat', label: 'Oct 31' })
  })
})

describe('opponentsByTeamDate', () => {
  const opponents = opponentsByTeamDate(schedule([
    team('BOS', [game({ date: '2026-10-18', opponent_abbreviation: 'NYK', is_home: true })]),
    team('LAL', [game({ date: '2026-10-19', opponent_abbreviation: 'DEN', is_home: false })]),
  ]))

  it('returns the opponent abbreviation for a home game', () => {
    expect(weekOpponent(opponents, 'BOS', '2026-10-18')).toBe('NYK')
  })

  it('returns the opponent abbreviation for an away game', () => {
    expect(weekOpponent(opponents, 'LAL', '2026-10-19')).toBe('DEN')
  })

  it('is blank when that team has no game that day', () => {
    expect(weekOpponent(opponents, 'BOS', '2026-10-20')).toBeUndefined()
  })

  it('counts games inside the shown week', () => {
    const days = [
      { date: '2026-10-18' },
      { date: '2026-10-19' },
      { date: '2026-10-20' },
    ]
    expect(weekGameCount(opponents, 'BOS', days)).toBe(1)
    expect(weekGameCount(opponents, 'LAL', days)).toBe(1)
    expect(weekGameCount(opponents, 'DEN', days)).toBe(0)
  })
})

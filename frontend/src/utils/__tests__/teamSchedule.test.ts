import { describe, expect, it } from 'vitest'
import type { ScheduleGame, ScheduleTeam, TeamGameResult } from '../../types/api'
import { boxScoreHref, initialScrollTarget, rowsForView, scheduleRows, seasonRecord } from '../teamSchedule'

const game = (id: string, date: string, opponent_id = 2): ScheduleGame => ({
  game_id: id, date, opponent_id, opponent: 'Opp', opponent_abbreviation: 'OPP', is_home: true, rest_days: 1, slate_size: 8, high_volume: false,
})
const team = (games: ScheduleGame[]): ScheduleTeam => ({
  team_id: 5, abbreviation: 'CLE', team_name: 'Cleveland Cavaliers', games, monthly_games: {}, total_games: games.length, b2b_count: 0, high_volume_games: 0,
} as ScheduleTeam)
const result = (id: string, date: string, won: boolean, is_home = true, opponent_id = 2): TeamGameResult => ({
  game_id: id, date, is_home, opponent_id, opponent_abbreviation: 'OPP', team_score: won ? 110 : 100, opponent_score: won ? 100 : 110, won,
})

describe('scheduleRows', () => {
  const games = [game('a', '2026-11-20'), game('b', '2026-11-22'), game('c', '2026-11-24'), game('d', '2026-11-26')]

  it('joins scores by game id and marks what has been played', () => {
    const rows = scheduleRows(team(games), [result('a', '2026-11-20', true)], '2026-11-24')
    expect(rows.map(row => [row.game.game_id, row.played, row.result?.won ?? null])).toEqual([
      ['a', true, true], ['b', true, null], ['c', false, null], ['d', false, null],
    ])
  })

  it('falls back to date and opponent when the ids differ', () => {
    const rows = scheduleRows(team(games), [result('other-id', '2026-11-22', false)], '2026-11-24')
    expect(rows[1].result?.won).toBe(false)
  })

  it('counts a game played today once its final score is in', () => {
    const rows = scheduleRows(team(games), [result('c', '2026-11-24', true)], '2026-11-24')
    expect(rows[2].played).toBe(true)
  })

  it('filters each view, keeping date order', () => {
    const rows = scheduleRows(team(games), [], '2026-11-24')
    expect(rowsForView(rows, 'results').map(row => row.game.game_id)).toEqual(['a', 'b'])
    expect(rowsForView(rows, 'upcoming').map(row => row.game.game_id)).toEqual(['c', 'd'])
    expect(rowsForView(rows, 'all').map(row => row.game.game_id)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('seasonRecord', () => {
  it('gives the record, home, away and last 10', () => {
    const results = [
      result('1', '2026-10-22', false, false), result('2', '2026-10-24', true), result('3', '2026-10-26', true),
      ...Array.from({ length: 9 }, (_, i) => result(`x${i}`, `2026-11-${String(i + 1).padStart(2, '0')}`, i % 3 === 0)),
    ]
    expect(seasonRecord(results)).toEqual({ record: '5-7', home: '5-6', away: '0-1', last10: '4-6' })
    expect(seasonRecord([]).record).toBe('0-0')
  })
})

describe('initialScrollTarget', () => {
  it('opens Results at the latest game, All a few rows above today, Upcoming at the top', () => {
    expect(initialScrollTarget('results', 18, 18)).toBe('bottom')
    expect(initialScrollTarget('upcoming', 64, 0)).toBe('top')
    expect(initialScrollTarget('all', 82, 18)).toBe(15)
    expect(initialScrollTarget('all', 82, 2)).toBe(0)
    // Before the season: nothing played, start at the top. After it: the end.
    expect(initialScrollTarget('all', 82, 0)).toBe('top')
    expect(initialScrollTarget('all', 82, 82)).toBe('bottom')
  })
})

it('links a game to its box score', () => {
  expect(boxScoreHref(game('401910007', '2026-11-18'))).toBe('/box-scores?date=2026-11-18&game=401910007')
})

import { describe, expect, it } from 'vitest'
import type { PlayerGameLogGame } from '../../types/api'
import { sortGameLog, toggleGameLogSort, type GameLogSort } from '../playerGameLog'

function game(overrides: Partial<PlayerGameLogGame>): PlayerGameLogGame {
  return {
    game_id: '1',
    season: '2026-27',
    game_date: '2026-10-28',
    opponent: 'LAL',
    is_home: true,
    team_pts: 100,
    opp_pts: 90,
    minutes: 20,
    pts: 10,
    reb: 1,
    ast: 1,
    stl: 0,
    blk: 0,
    tov: 1,
    fg3m: 1,
    fg3a: 2,
    fgm: 4,
    fga: 10,
    ftm: 1,
    fta: 2,
    plus_minus: 0,
    ...overrides,
  }
}

const newer = game({ game_id: '2', game_date: '2026-11-02', opponent: 'BOS', pts: 12, fgm: 1, fga: 2 })
const older = game({ game_id: '1', game_date: '2026-10-20', opponent: 'NYK', pts: 30, fgm: 8, fga: 10 })
const noFt = game({ game_id: '3', game_date: '2026-10-25', opponent: 'MIA', pts: 12, ftm: 0, fta: 0 })

function ids(games: PlayerGameLogGame[], sort: GameLogSort, zs = new Map<string, number>()): string[] {
  return sortGameLog(games, zs, sort).map((g) => g.game_id)
}

describe('sortGameLog', () => {
  it('starts newest first and flips the date', () => {
    expect(ids([older, newer], { key: 'date', dir: 'desc' })).toEqual(['2', '1'])
    expect(ids([older, newer], { key: 'date', dir: 'asc' })).toEqual(['1', '2'])
  })

  it('sorts a counting stat high to low, keeping the newer game first on a tie', () => {
    expect(ids([newer, older], { key: 'pts', dir: 'desc' })).toEqual(['1', '2'])
    const tied = game({ game_id: '4', game_date: '2026-10-01', pts: 12 })
    expect(ids([tied, newer], { key: 'pts', dir: 'desc' })).toEqual(['2', '4'])
  })

  it('sorts shooting by percentage and leaves a line with no attempts at the bottom', () => {
    expect(ids([newer, older, noFt], { key: 'FG', dir: 'desc' })).toEqual(['1', '2', '3'])
    expect(ids([newer, older, noFt], { key: 'FT', dir: 'asc' })[2]).toBe('3')
  })

  it('sorts usage and keeps a game without one at the bottom', () => {
    const high = game({ game_id: '5', game_date: '2026-11-01', usg: 33 })
    const low = game({ game_id: '6', game_date: '2026-10-30', usg: 12.5 })
    expect(ids([low, high, noFt], { key: 'usg', dir: 'desc' })).toEqual(['5', '6', '3'])
  })

  it('sorts Z and keeps a game without one at the bottom', () => {
    const zs = new Map([['1', 1.2], ['2', -0.4]])
    expect(ids([newer, older, noFt], { key: 'z', dir: 'desc' }, zs)).toEqual(['1', '2', '3'])
  })

  it('sorts by fantasy team name and leaves a night with no team at the bottom', () => {
    const owned = game({
      game_id: '9',
      game_date: '2026-11-08',
      fantasy: { fantasy_team: 'DOR', fantasy_team_name: 'DORELIT', lineup_slot: 'BE', started: false },
    })
    const later = game({
      game_id: '8',
      game_date: '2026-11-10',
      fantasy: { fantasy_team: 'TTP', fantasy_team_name: 'Trust the process', lineup_slot: 'PG', started: true },
    })
    expect(toggleGameLogSort({ key: 'date', dir: 'desc' }, 'team')).toEqual({ key: 'team', dir: 'asc' })
    expect(ids([later, owned, noFt], { key: 'team', dir: 'asc' })).toEqual(['9', '8', '3'])
  })

  it('sorts the opponent A to Z on the first click', () => {
    expect(toggleGameLogSort({ key: 'date', dir: 'desc' }, 'opp')).toEqual({ key: 'opp', dir: 'asc' })
    expect(ids([older, newer], { key: 'opp', dir: 'asc' })).toEqual(['2', '1'])
    expect(toggleGameLogSort({ key: 'pts', dir: 'desc' }, 'pts')).toEqual({ key: 'pts', dir: 'asc' })
  })
})

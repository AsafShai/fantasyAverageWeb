import { describe, expect, it } from 'vitest'
import type { Player } from '../../types/api'
import { ALL_PLAYERS, buildShotPool, inScope, POOL_SIZE, rankIn } from '../shootingMap'

let nextId = 1
function player(name: string, team: string, gp: number, fgm: number, fga: number, ftm = 2, fta = 3, pts = 10): Player {
  return {
    player_name: name,
    pro_team: team,
    positions: ['SF'],
    player_id: nextId++,
    stats: {
      pts: pts * gp, reb: 4 * gp, ast: 3 * gp, stl: gp, blk: gp, three_pm: gp,
      fgm: fgm * gp, fga: fga * gp, ftm: ftm * gp, fta: fta * gp,
      fg_percentage: fgm / fga, ft_percentage: fta ? ftm / fta : 0,
      minutes: 30 * gp, gp,
    },
    team_id: 0,
    status: 'FREEAGENT',
  }
}

describe('inScope', () => {
  const rostered = { ...player('Owned', 'BOS', 4, 5, 10), team_id: 3 }
  const freeAgent = player('Free', 'BOS', 4, 5, 10)
  it('matches a fantasy team, free agents (0) or anyone rostered, alongside the NBA team', () => {
    expect(inScope(rostered, { nba: null, fantasy: 3 })).toBe(true)
    expect(inScope(freeAgent, { nba: null, fantasy: 3 })).toBe(false)
    expect(inScope(freeAgent, { nba: null, fantasy: 0 })).toBe(true)
    expect(inScope(rostered, { nba: null, fantasy: 'rostered' })).toBe(true)
    expect(inScope(freeAgent, { nba: null, fantasy: 'rostered' })).toBe(false)
    expect(inScope(rostered, { nba: 'LAL', fantasy: 3 })).toBe(false)
    expect(inScope(rostered, ALL_PLAYERS)).toBe(true)
  })
})

describe('buildShotPool', () => {
  it('keeps the top 200 by fantasy value and skips players under 2 games', () => {
    const players = Array.from({ length: 230 }, (_, i) => player(`P${i}`, 'BOS', 5, 5, 10, 2, 3, 30 - i / 10))
    players.push(player('One Game', 'BOS', 1, 9, 10, 2, 3, 50))
    const { pool, frank, eligible } = buildShotPool(players)
    expect(pool).toHaveLength(POOL_SIZE)
    expect(pool[0].player_name).toBe('P0')
    expect(eligible.some(p => p.player_name === 'One Game')).toBe(false)
    expect(frank.get(String(pool[0].player_id))).toBe(1)
  })
})

describe('buildShotPool min games', () => {
  it('follows the chosen minimum, never below one game', () => {
    const players = [player('Two', 'BOS', 2, 5, 10), player('Five', 'BOS', 5, 5, 10), player('None', 'BOS', 0, 0, 0)]
    expect(buildShotPool(players, undefined, undefined, 5).eligible.map(p => p.player_name)).toEqual(['Five'])
    expect(buildShotPool(players, undefined, undefined, 0).eligible.map(p => p.player_name)).toEqual(['Two', 'Five'])
  })
})

describe('inScope positions', () => {
  it('matches any of the picked positions', () => {
    const wing = { ...player('Wing', 'BOS', 4, 5, 10), positions: ['SG', 'SF'] }
    expect(inScope(wing, { nba: null, fantasy: null, positions: ['SF', 'C'] })).toBe(true)
    expect(inScope(wing, { nba: null, fantasy: null, positions: ['PG', 'C'] })).toBe(false)
    expect(inScope(wing, { nba: null, fantasy: null, positions: [] })).toBe(true)
  })
})

describe('rankIn', () => {
  it('shares a rank between ties', () => {
    expect(rankIn([9, 7, 7, 3], 9)).toBe(1)
    expect(rankIn([9, 7, 7, 3], 7)).toBe(2)
    expect(rankIn([9, 7, 7, 3], 3)).toBe(4)
  })
})

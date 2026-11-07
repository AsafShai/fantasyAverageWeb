import { describe, expect, it } from 'vitest'
import type { Player } from '../../types/api'
import { ALL_PLAYERS, buildShotPool, deriveShotData, impactLists, inScope, passesFilter, POOL_SIZE, signedImpact } from '../shootingMap'

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

describe('deriveShotData', () => {
  const a = player('Accurate Big', 'BOS', 4, 8, 10)
  const b = player('Volume Guard', 'LAL', 4, 8, 20)
  const frank = new Map<string, number>()

  it('measures impact against the pool average percentage', () => {
    const d = deriveShotData([a, b], [], frank, 'fg', 'pg')
    // pool: 16 makes on 30 attempts per game
    expect(d.avgPct).toBeCloseTo(16 / 30)
    expect(d.avgAtt).toBe(15)
    const acc = d.rows.find(r => r.name === 'Accurate Big')!
    expect(acc.imp).toBeCloseTo(8 - (16 / 30) * 10)
    expect(acc.imp).toBeGreaterThan(0)
    expect(acc.rImp).toBe(1)
    expect(d.rows.find(r => r.name === 'Volume Guard')!.rVol).toBe(1)
  })

  it('keeps the same average % per game and in totals', () => {
    const few = player('Few Games', 'X', 2, 9, 10)
    const many = player('Many Games', 'X', 10, 4, 10)
    const pg = deriveShotData([few, many], [], frank, 'fg', 'pg')
    const tot = deriveShotData([few, many], [], frank, 'fg', 'tot')
    expect(pg.avgPct).toBeCloseTo((18 + 40) / (20 + 100))
    expect(tot.avgPct).toBeCloseTo(pg.avgPct)
  })

  it('switches to season totals', () => {
    const d = deriveShotData([a, b], [], frank, 'fg', 'tot')
    expect(d.rows.find(r => r.name === 'Accurate Big')!.a).toBe(40)
  })

  it('drops players with no attempts', () => {
    const noFt = player('No Free Throws', 'BOS', 4, 5, 10, 0, 0)
    const d = deriveShotData([a, noFt], [], frank, 'ft', 'pg')
    expect(d.rows.map(r => r.name)).toEqual(['Accurate Big'])
  })

  it('measures extra players without moving the pool averages', () => {
    const extra = player('Bench Shooter', 'BOS', 4, 1, 1)
    const withExtra = deriveShotData([a, b], [extra], frank, 'fg', 'pg')
    const without = deriveShotData([a, b], [], frank, 'fg', 'pg')
    expect(withExtra.avgPct).toBe(without.avgPct)
    const row = withExtra.rows.find(r => r.name === 'Bench Shooter')!
    expect(row.inPool).toBe(false)
    // below the attempt minimum: no percentage rank
    expect(row.rPct).toBeNull()
  })

  it('leaves out a team\'s bench players with too few attempts', () => {
    const garbageTime = player('Garbage Time', 'BOS', 4, 0, 0.5)
    const d = deriveShotData([a, b], [garbageTime], frank, 'fg', 'pg')
    expect(d.rows.some(r => r.name === 'Garbage Time')).toBe(false)
  })
})

describe('passesFilter', () => {
  it('keeps only the picked NBA team', () => {
    const d = deriveShotData([player('A', 'BOS', 4, 8, 10), player('B', 'LAL', 4, 8, 20)], [], new Map(), 'fg', 'pg')
    expect(d.rows.filter(r => passesFilter(r, d, 'all', { nba: 'BOS', fantasy: null })).map(r => r.name)).toEqual(['A'])
    expect(d.rows.filter(r => passesFilter(r, d, 'imp', ALL_PLAYERS)).map(r => r.name)).toEqual(['A'])
  })
})

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

describe('impactLists', () => {
  it('lists only helpers as best and only hurters as worst', () => {
    const d = deriveShotData([player('A', 'X', 4, 8, 10), player('B', 'X', 4, 4, 10), player('C', 'X', 4, 7, 10)], [], new Map(), 'fg', 'pg')
    const { top, bottom } = impactLists(d.rows, 6)
    expect(top.map(r => r.name)).toEqual(['A', 'C'])
    expect(bottom.map(r => r.name)).toEqual(['B'])
  })
})

describe('signedImpact', () => {
  it('drops the sign when the value rounds to zero', () => {
    expect(signedImpact(0.3, 'tot')).toBe('0')
    expect(signedImpact(-0.04, 'pg')).toBe('0')
    expect(signedImpact(1.26, 'pg')).toBe('+1.3')
    expect(signedImpact(-2.6, 'tot')).toBe('−3')
  })
})

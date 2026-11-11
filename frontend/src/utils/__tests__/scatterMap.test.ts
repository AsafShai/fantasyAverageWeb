import { describe, expect, it } from 'vitest'
import type { Player } from '../../types/api'
import { ALL_PLAYERS, buildShotPool } from '../shootingMap'
import {
  AXIS_ORDER, buildChart, customMeta, deriveCustom, deriveRates, deriveShots, flipMeta, MODES, passesFilter, ruleOf, scoreLists, SHOTS, shotMeta, signed, STATS,
  type StatId,
} from '../scatterMap'

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
/** A player with his per-game line spelled out. */
function line(name: string, per: { gp?: number; min?: number; pts?: number; stl?: number; blk?: number; fgm?: number; fga?: number; ftm?: number; fta?: number }): Player {
  const gp = per.gp ?? 4
  const p = player(name, 'X', gp, per.fgm ?? 5, per.fga ?? 10, per.ftm ?? 2, per.fta ?? 3, per.pts ?? 10)
  p.stats.minutes = (per.min ?? 30) * gp
  p.stats.stl = (per.stl ?? 1) * gp
  p.stats.blk = (per.blk ?? 1) * gp
  return p
}
const [FG, FT, TS] = SHOTS
const frank = new Map<string, number>()

describe('ruleOf', () => {
  it('keeps the shooting impact for a shooting pair, in either order', () => {
    expect(ruleOf('FG%', 'FGA')).toMatchObject({ kind: 'shot', chart: FG, flip: false })
    expect(ruleOf('FTA', 'FT%')).toMatchObject({ kind: 'shot', chart: FT, flip: true })
    expect(ruleOf('TS%', 'PTS')).toMatchObject({ kind: 'shot', chart: TS, flip: false })
  })

  it('colors a counting stat against minutes per minute', () => {
    expect(ruleOf('MIN', 'REB')).toEqual({ kind: 'rate', stat: 'REB', flip: false })
    expect(ruleOf('STL', 'MIN')).toEqual({ kind: 'rate', stat: 'STL', flip: true })
  })

  it('falls back to z-scores for every other pair', () => {
    for (const [x, y] of [['STL', 'BLK'], ['MIN', 'FG%'], ['MIN', 'FGA'], ['MIN', 'FG Imp'], ['FG%', 'FTA'], ['FG Imp', 'FGA']] as [StatId, StatId][]) {
      expect(ruleOf(x, y).kind).toBe('z')
    }
  })

  it('gives every pair of axes a rule and every menu option known stats', () => {
    for (const x of AXIS_ORDER) for (const y of AXIS_ORDER) if (x !== y) expect(ruleOf(x, y).kind).toMatch(/shot|rate|z/)
    for (const mode of MODES) for (const o of mode.options) expect(STATS[o.x] && STATS[o.y]).toBeTruthy()
    expect(MODES[0].options.every(o => ruleOf(o.x, o.y).kind === 'shot')).toBe(true)
    expect(MODES[1].options.every(o => ruleOf(o.x, o.y).kind === 'rate')).toBe(true)
  })
})

describe('deriveShots', () => {
  const a = player('Accurate Big', 'BOS', 4, 8, 10)
  const b = player('Volume Guard', 'LAL', 4, 8, 20)

  it('measures impact against the pool average percentage', () => {
    const d = deriveShots([a, b], [], frank, FG, 'pg')
    // pool: 16 makes on 30 attempts per game
    expect(d.avgX).toBeCloseTo(16 / 30)
    expect(d.avgY).toBe(15)
    const acc = d.rows.find(r => r.name === 'Accurate Big')!
    expect(acc.imp).toBeCloseTo(8 - (16 / 30) * 10)
    expect(acc.imp).toBeGreaterThan(0)
    expect(acc.rImp).toBe(1)
    expect(d.rows.find(r => r.name === 'Volume Guard')!.rY).toBe(1)
  })

  it('keeps the same average % per game and in totals', () => {
    const few = player('Few Games', 'X', 2, 9, 10)
    const many = player('Many Games', 'X', 10, 4, 10)
    const pg = deriveShots([few, many], [], frank, FG, 'pg')
    const tot = deriveShots([few, many], [], frank, FG, 'tot')
    expect(pg.avgX).toBeCloseTo((18 + 40) / (20 + 100))
    expect(tot.avgX).toBeCloseTo(pg.avgX)
  })

  it('switches to season totals', () => {
    const d = deriveShots([a, b], [], frank, FG, 'tot')
    expect(d.rows.find(r => r.name === 'Accurate Big')!.a).toBe(40)
  })

  it('drops players with no attempts', () => {
    const noFt = player('No Free Throws', 'BOS', 4, 5, 10, 0, 0)
    const d = deriveShots([a, noFt], [], frank, FT, 'pg')
    expect(d.rows.map(r => r.name)).toEqual(['Accurate Big'])
  })

  it('measures extra players without moving the pool averages', () => {
    const extra = player('Bench Shooter', 'BOS', 4, 1, 1)
    const withExtra = deriveShots([a, b], [extra], frank, FG, 'pg')
    const without = deriveShots([a, b], [], frank, FG, 'pg')
    expect(withExtra.avgX).toBe(without.avgX)
    const row = withExtra.rows.find(r => r.name === 'Bench Shooter')!
    expect(row.inPool).toBe(false)
    // below the attempt minimum: no percentage rank
    expect(row.rPct).toBeNull()
  })

  it('leaves out a team\'s bench players with too few attempts', () => {
    const garbageTime = player('Garbage Time', 'BOS', 4, 0, 0.5)
    const d = deriveShots([a, b], [garbageTime], frank, FG, 'pg')
    expect(d.rows.some(r => r.name === 'Garbage Time')).toBe(false)
  })

  it('charts true shooting against points, scored in points', () => {
    // 20 points on 10 FGA + 3 FTA, and 10 points on the same shots
    const scorer = player('Scorer', 'X', 4, 5, 10, 2, 3, 20), other = player('Other', 'X', 4, 5, 10, 2, 3, 10)
    const d = deriveShots([scorer, other], [], frank, TS, 'pg')
    const row = d.rows.find(r => r.name === 'Scorer')!
    expect(row.x).toBeCloseTo(20 / (2 * (10 + 0.44 * 3)))
    expect(row.y).toBe(20)
    // makes above average are half-points: the meta shows them as points
    expect(shotMeta(d, TS, 'pg').impact(row)).toBe('+5.0')
    expect(shotMeta(d, TS, 'pg').words.best).toBe('Most efficient scorers')
  })
})

describe('deriveRates', () => {
  it('scores a stat per 36 minutes against everyone handed in', () => {
    const bench = line('Bench Thief', { min: 12, stl: 1 }), starter = line('Starter', { min: 36, stl: 1.5 })
    const d = deriveRates([bench, starter], frank, STATS.STL)
    const b = d.rows.find(r => r.name === 'Bench Thief')!, s = d.rows.find(r => r.name === 'Starter')!
    expect(b.x).toBe(12)
    expect(b.y).toBe(1)
    expect(b.imp).toBeCloseTo(3)
    expect(s.imp).toBeCloseTo(1.5)
    // the pool's rate: all steals over all minutes
    expect(d.mean).toBeCloseTo((1 + 1.5) / (12 + 36) * 36)
    expect(b.z).toBeGreaterThan(0)
    expect(s.z).toBeLessThan(0)
    expect(b.rImp).toBe(1)
    expect(s.rY).toBe(1)
  })

  it('leaves out players with no minutes', () => {
    const d = deriveRates([line('Played', {}), line('Sat', { min: 0 })], frank, STATS.PTS)
    expect(d.rows.map(r => r.name)).toEqual(['Played'])
  })
})

describe('deriveCustom', () => {
  const thief = line('Thief', { stl: 3, blk: 0 }), wall = line('Wall', { stl: 0, blk: 3 }), both = line('Both', { stl: 3, blk: 3 }), none = line('None', { stl: 0, blk: 0 })

  it('colors by the average of the two z-scores', () => {
    const d = deriveCustom([thief, wall, both, none], [], frank, STATS.STL, STATS.BLK)
    const row = (n: string) => d.rows.find(r => r.name === n)!
    expect(row('Both').zx).toBeCloseTo(1)
    expect(row('Both').z).toBeCloseTo(1)
    expect(row('Thief').z).toBeCloseTo(0)
    expect(row('None').z).toBeCloseTo(-1)
    expect(row('Both').rImp).toBe(1)
    expect(d.avgX).toBe(1.5)
  })

  it('draws a volume stat without scoring it', () => {
    const busy = line('Busy', { stl: 1, fga: 20, fgm: 10 }), quiet = line('Quiet', { stl: 3, fga: 5, fgm: 2.5 })
    const d = deriveCustom([busy, quiet], [], frank, STATS.STL, STATS.FGA)
    const q = d.rows.find(r => r.name === 'Quiet')!
    expect(q.y).toBe(5)
    expect(q.z).toBeCloseTo(q.zx)
    expect(q.z).toBeGreaterThan(0)
    const gray = deriveCustom([busy, quiet], [], frank, STATS.MIN, STATS.FGA)
    expect(gray.rows.every(r => r.z === 0)).toBe(true)
  })

  it('scores a percentage by makes above the pool percentage, so volume counts', () => {
    // the same 60% on 20 and on 5 attempts, next to a 40% shooter
    const many = line('Many', { fgm: 12, fga: 20 }), few = line('Few', { fgm: 3, fga: 5 }), cold = line('Cold', { fgm: 8, fga: 20 })
    const d = deriveCustom([many, few, cold], [], frank, STATS['FG%'], STATS.STL)
    const row = (n: string) => d.rows.find(r => r.name === n)!
    expect(row('Many').x).toBeCloseTo(row('Few').x)
    expect(row('Many').zx).toBeGreaterThan(row('Few').zx)
  })

  it('gives FG Imp the shooting chart\'s impact, per game', () => {
    const pool = [line('Many', { fgm: 12, fga: 20 }), line('Few', { fgm: 3, fga: 5 }), line('Cold', { fgm: 8, fga: 20 })]
    const shots = deriveShots(pool, [], frank, FG, 'pg')
    const custom = deriveCustom(pool, [], frank, STATS['FG Imp'], STATS.STL)
    for (const r of custom.rows) expect(r.x).toBeCloseTo(shots.rows.find(s => s.key === r.key)!.imp)
    // an impact can be negative: the frame goes under zero
    expect(custom.x0).toBeLessThan(0)
    const meta = customMeta(custom, 'FG Imp', 'STL')
    expect(meta.signedX).toBe(true)
    const many = custom.rows.find(r => r.name === 'Many')!
    expect(meta.pin(many)).toEqual(['+1.8 FG Imp (#1) · 60.0% on 20.0 FGA', '1.0 STL (#1)'])
    expect(meta.tipRows(many).find(r => r.k === 'Behind FG Imp')!.v).toBe('60.0% on 20.0 FGA')
  })

  it('asks extra players for a real sample behind a percentage', () => {
    const pool = [line('A', {}), line('B', { fgm: 6 })]
    const d = deriveCustom(pool, [line('Garbage Time', { fgm: 0.5, fga: 0.5 }), line('Bench', { fgm: 1, fga: 2 })], frank, STATS['FG%'], STATS.STL)
    expect(d.rows.map(r => r.name)).toEqual(['A', 'B', 'Bench'])
    expect(d.rows[2].inPool).toBe(false)
  })
})

describe('customMeta', () => {
  const pool = [line('A', { stl: 3 }), line('B', { stl: 1 })]
  it('names the lists and chips after the scored stats', () => {
    const two = customMeta(deriveCustom(pool, [], frank, STATS.STL, STATS.BLK), 'STL', 'BLK')
    expect(two.words).toMatchObject({ best: 'Best STL + BLK', worst: 'Lowest STL + BLK', chipGood: 'Above avg combined' })
    expect(two.lines).toBe(true)
    const one = customMeta(deriveCustom(pool, [], frank, STATS.STL, STATS.FGA), 'STL', 'FGA')
    expect(one.words).toMatchObject({ best: 'Highest STL', chipGood: null })
    const none = customMeta(deriveCustom(pool, [], frank, STATS.MIN, STATS.FGA), 'MIN', 'FGA')
    expect(none.words.best).toBe('Above average')
    // a percentage has no straight equal-score line
    expect(customMeta(deriveCustom(pool, [], frank, STATS['FG%'], STATS.STL), 'FG%', 'STL').lines).toBe(false)
  })
})

describe('flipMeta', () => {
  it('exchanges the axes\' words, formats and curves', () => {
    const d = deriveShots([player('A', 'X', 4, 8, 10), player('B', 'X', 4, 8, 20)], [], frank, FG, 'pg')
    const M = shotMeta(d, FG, 'pg'), F = flipMeta(M)
    expect(F.xTitle).toBe(M.yTitle)
    expect(F.th1).toBe(M.th2)
    expect(F.words.chipX).toBe(M.words.chipY)
    expect(F.quads).toEqual([M.quads[0], M.quads[2], M.quads[1], M.quads[3]])
    const b = { vx0: 0.3, vx1: 0.9, vy0: 0, vy1: 25 }
    const curve = M.curves(b)[0], flipped = F.curves({ vx0: b.vy0, vx1: b.vy1, vy0: b.vx0, vy1: b.vx1 })[0]
    expect(flipped.pts[0]).toEqual([curve.pts[0][1], curve.pts[0][0]])
  })
})

describe('buildChart', () => {
  const players = [
    ...Array.from({ length: 12 }, (_, i) => line(`P${i}`, { min: 20 + i, pts: 10 + i, stl: 1 + i / 10, fgm: 4 + i / 4 })),
    line('Deep Bench', { min: 6, pts: 2, stl: 0.2 }),
  ]
  const sp = buildShotPool(players)

  it('draws a flipped pair with the axes exchanged', () => {
    const straight = buildChart(sp, 'FG%', 'FGA', 'pg', ALL_PLAYERS, 10)
    const flipped = buildChart(sp, 'FGA', 'FG%', 'pg', ALL_PLAYERS, 10)
    const a = straight.data.rows[0], b = flipped.data.rows.find(r => r.key === a.key)!
    expect([b.px, b.py]).toEqual([a.py, a.px])
    expect(b.z).toBe(a.z)
    expect(flipped.view.avgX).toBe(straight.view.avgY)
    expect(flipped.meta.xTitle).toBe(straight.meta.yTitle)
  })

  it('applies the minutes floor whenever minutes are on an axis', () => {
    expect(buildChart(sp, 'MIN', 'PTS', 'pg', ALL_PLAYERS, 10).data.rows.some(r => r.name === 'Deep Bench')).toBe(false)
    expect(buildChart(sp, 'MIN', 'PTS', 'pg', ALL_PLAYERS, 0).data.rows.some(r => r.name === 'Deep Bench')).toBe(true)
    expect(buildChart(sp, 'MIN', 'FG%', 'pg', ALL_PLAYERS, 10).data.rows.some(r => r.name === 'Deep Bench')).toBe(false)
    expect(buildChart(sp, 'STL', 'PTS', 'pg', ALL_PLAYERS, 10).data.rows.some(r => r.name === 'Deep Bench')).toBe(true)
  })

  it('shows totals only on a shooting chart', () => {
    expect(buildChart(sp, 'FG%', 'FGA', 'tot', ALL_PLAYERS, 10).unit).toBe('tot')
    expect(buildChart(sp, 'STL', 'BLK', 'tot', ALL_PLAYERS, 10).unit).toBe('pg')
    expect(buildChart(sp, 'MIN', 'PTS', 'tot', ALL_PLAYERS, 10).unit).toBe('pg')
  })
})

describe('passesFilter', () => {
  const d = deriveShots([player('A', 'BOS', 4, 8, 10), player('B', 'LAL', 4, 8, 20)], [], frank, FG, 'pg')

  it('keeps only the picked NBA team', () => {
    expect(d.rows.filter(r => passesFilter(r, d, 'all', { nba: 'BOS', fantasy: null })).map(r => r.name)).toEqual(['A'])
    expect(d.rows.filter(r => passesFilter(r, d, 'good', ALL_PLAYERS)).map(r => r.name)).toEqual(['A'])
    expect(d.rows.filter(r => passesFilter(r, d, 'y', ALL_PLAYERS)).map(r => r.name)).toEqual(['B'])
  })

  it('drops players under the minimum x or y', () => {
    const data = deriveShots([player('Sharp', 'X', 4, 6, 10), player('Busy', 'X', 4, 9, 20)], [], frank, FG, 'pg')
    const names = (minX: number | null, minY: number | null) =>
      data.rows.filter(r => passesFilter(r, data, 'all', ALL_PLAYERS, { minX, minY })).map(r => r.name)
    expect(names(0.5, null)).toEqual(['Sharp'])
    expect(names(null, 15)).toEqual(['Busy'])
    expect(names(0.5, 15)).toEqual([])
    expect(names(null, null)).toEqual(['Sharp', 'Busy'])
  })
})

describe('scoreLists', () => {
  it('lists only helpers as best and only hurters as worst', () => {
    const d = deriveShots([player('A', 'X', 4, 8, 10), player('B', 'X', 4, 4, 10), player('C', 'X', 4, 7, 10)], [], frank, FG, 'pg')
    const { top, bottom } = scoreLists(d.rows, 6)
    expect(top.map(r => r.name)).toEqual(['A', 'C'])
    expect(bottom.map(r => r.name)).toEqual(['B'])
  })
})

describe('signed', () => {
  it('drops the sign when the value rounds to zero', () => {
    expect(signed(0.3, 0)).toBe('0')
    expect(signed(-0.04, 1)).toBe('0')
    expect(signed(1.26, 1)).toBe('+1.3')
    expect(signed(-2.6, 0)).toBe('−3')
  })
})

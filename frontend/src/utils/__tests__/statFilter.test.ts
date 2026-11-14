import { describe, expect, it } from 'vitest'
import type { Player, StatFilter } from '../../types/api'
import { parseStatFilterValue, passesStatFilter } from '../statFilter'

const player = (stats: Partial<Player['stats']>): Player => ({
  player_name: 'p', pro_team: 'LAL', positions: ['PG'], team_id: 1, status: 'ONTEAM',
  stats: {
    pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fgm: 0, fga: 0, ftm: 0, fta: 0,
    fg_percentage: 0, ft_percentage: 0, three_pm: 0, minutes: 0, gp: 0, ...stats,
  },
})

const f = (stat: StatFilter['stat'], operator: StatFilter['operator'], value: number): StatFilter => ({ stat, operator, value })

describe('parseStatFilterValue', () => {
  it('reads numbers, including 0', () => {
    expect(parseStatFilterValue('0')).toBe(0)
    expect(parseStatFilterValue('20.5')).toBe(20.5)
  })

  it('rejects an empty or non-numeric box instead of returning NaN', () => {
    expect(parseStatFilterValue('')).toBeNull()
    expect(parseStatFilterValue('  ')).toBeNull()
    expect(parseStatFilterValue('abc')).toBeNull()
  })
})

describe('passesStatFilter', () => {
  const scorer = player({ pts: 401, gp: 20, fg_percentage: 0.4734 }) // 20.05 PPG

  it('compares per-game values when averages are on, totals otherwise', () => {
    expect(passesStatFilter(scorer, f('pts', 'gt', 20), true)).toBe(true)
    expect(passesStatFilter(scorer, f('pts', 'gt', 400), true)).toBe(false)
    expect(passesStatFilter(scorer, f('pts', 'gt', 400), false)).toBe(true)
  })

  it('matches "=" at the precision typed, since averages are never exact', () => {
    expect(passesStatFilter(scorer, f('pts', 'eq', 20), true)).toBe(true)
    expect(passesStatFilter(scorer, f('pts', 'eq', 20.1), true)).toBe(true)
    expect(passesStatFilter(scorer, f('pts', 'eq', 20.05), true)).toBe(true)
    expect(passesStatFilter(scorer, f('pts', 'eq', 21), true)).toBe(false)
  })

  it('takes percentages as 0-100', () => {
    expect(passesStatFilter(scorer, f('fg_percentage', 'gte', 47), true)).toBe(true)
    expect(passesStatFilter(scorer, f('fg_percentage', 'lt', 47), true)).toBe(false)
    expect(passesStatFilter(scorer, f('fg_percentage', 'eq', 47.3), false)).toBe(true)
  })
})

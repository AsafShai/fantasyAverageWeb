import { describe, expect, it } from 'vitest'
import type { Player } from '../../../../types/api'
import { buildTradeComparison, sideLabels } from '../comparison'
import { formatMobileStat, fraction3 } from '../format'

const p = (name: string, pts: number, fgm: number, fga: number, gp = 2): Player => ({
  player_name: name, pro_team: 'LAL', positions: ['PG'], team_id: 1, status: 'ONTEAM',
  stats: { pts, reb: 0, ast: 0, stl: 0, blk: 0, fgm, fga, ftm: 0, fta: 0, fg_percentage: fga ? fgm / fga : 0, ft_percentage: 0, three_pm: 0, minutes: 60, gp },
})

const teamA = { team_id: 1, team_name: 'Trust the process' }
const teamB = { team_id: 2, team_name: 'DORELIT' }

describe('trade comparison (phone)', () => {
  it('labels rows by what each side gets', () => {
    expect(sideLabels('team', teamA, teamB)).toEqual(['Trust the process gets', 'DORELIT gets'])
    expect(sideLabels('team', null, null)).toEqual(['Team A gets', 'Team B gets'])
    expect(sideLabels('freeAgent', teamA, null)).toEqual(['Drop', 'Add'])
  })

  it('team trade: team A receives team B’s players', () => {
    const giddey = p('Giddey', 20, 8, 20)
    const holiday = p('Holiday', 30, 12, 24)
    const { rows, ready } = buildTradeComparison({
      teamA, teamB, playersA: [giddey], playersB: [holiday], viewMode: 'totals', tradeMode: 'team', periodLabel: 'Season',
    })
    expect(ready).toBe(true)
    expect(rows[0]).toMatchObject({ label: 'Trust the process gets', fixed: expect.objectContaining({ pts: 30 }) })
    expect(rows[1]).toMatchObject({ label: 'DORELIT gets', fixed: expect.objectContaining({ pts: 20 }) })
  })

  it('free agents: Drop is your players, Add the free agents; per game averages', () => {
    const mine = p('Mine', 20, 8, 20)
    const fa = p('FA', 10, 4, 8)
    const { rows } = buildTradeComparison({
      teamA, teamB: null, playersA: [mine], playersB: [fa], viewMode: 'averages', tradeMode: 'freeAgent', periodLabel: 'Season',
    })
    expect(rows.map((r) => r.players[0].player_name)).toEqual(['Mine', 'FA'])
    expect(rows[1].fixed.pts).toBe(5)
  })

  it('is not ready until both sides have players; Avg Z needs a value lookup', () => {
    const r = buildTradeComparison({ teamA, teamB, playersA: [p('A', 1, 1, 2)], playersB: [], viewMode: 'totals', tradeMode: 'team', periodLabel: 'Season' })
    expect(r.ready).toBe(false)
    expect(r.showZ).toBe(false)
  })
})

describe('phone stat format', () => {
  it('formats like the design', () => {
    expect(fraction3(0.4461)).toBe('.446')
    expect(formatMobileStat('fg_percentage', 0.5, 'totals')).toBe('.500')
    expect(formatMobileStat('fg_percentage', 44.6, 'averages', 100)).toBe('.446')
    expect(formatMobileStat('pts', 13.44, 'averages')).toBe('13.4')
    expect(formatMobileStat('pts', 120.6, 'totals')).toBe('121')
    expect(formatMobileStat('gp', 9, 'averages')).toBe('9')
  })
})

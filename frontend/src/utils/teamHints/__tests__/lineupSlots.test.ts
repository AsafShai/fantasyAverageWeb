import { describe, expect, it } from 'vitest'
import { benchPlayers, isStarterSlot, playerFillsSlot } from '../lineupSlots'
import type { RosterPlayer } from '../types'

const p = (over: Partial<RosterPlayer>): RosterPlayer =>
  ({
    player_name: 'Test',
    pro_team: 'LAL',
    positions: ['PG'],
    stats: { gp: 10, minutes: 200, pts: 10, reb: 2, ast: 2, stl: 1, blk: 0, fgm: 1, fga: 2, ftm: 1, fta: 1, fg_percentage: 0.5, ft_percentage: 0.5, three_pm: 0 },
    team_id: 1,
    status: 'ONTEAM',
    ...over,
  }) as RosterPlayer

describe('lineupSlots', () => {
  it('treats UTIL and position slots as starters', () => {
    expect(isStarterSlot('UTIL')).toBe(true)
    expect(isStarterSlot('BE')).toBe(false)
    expect(isStarterSlot('IR')).toBe(false)
  })

  it('matches G and F eligibility', () => {
    expect(playerFillsSlot(['PG'], 'G')).toBe(true)
    expect(playerFillsSlot(['C'], 'G')).toBe(false)
    expect(playerFillsSlot(['SF'], 'F')).toBe(true)
  })

  it('finds bench players', () => {
    const roster = [p({ lineup_slot: 'PG' }), p({ player_name: 'B', lineup_slot: 'BE' })]
    expect(benchPlayers(roster)).toHaveLength(1)
  })
})

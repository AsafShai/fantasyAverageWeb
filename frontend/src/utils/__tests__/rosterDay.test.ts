import { describe, expect, it } from 'vitest'
import type { RosterDay, RosterDayPlayer } from '../../types/api'
import { lineupSlotOrder, lockNote, moveMeta, pct, starterTotals } from '../rosterDay'

const stats = (pts: number, fgm: number, fga: number) => ({
  minutes: 30, fgm, fga, ftm: 2, fta: 4, three_pm: 1, reb: 5, ast: 3, stl: 1, blk: 0, pts, to: 2,
})

const player = (over: Partial<RosterDayPlayer>): RosterDayPlayer => ({
  player_id: 1, player_name: 'P', positions: ['PG'], pro_team: 'LAL', lineup_slot: 'PG',
  opponent: 'SAC', status: 'played', stats: stats(10, 4, 10), added: false, dropped: false, ...over,
})

const day = (over: Partial<RosterDay>): RosterDay => ({
  team_id: 1, date: '2026-11-04', scoring_period_id: 16, is_today: false, has_games: true,
  lock_at: '2026-11-05T00:00:00Z', first_date: '2026-10-20', last_date: '2026-11-05', players: [], moves: [], ...over,
})

describe('rosterDay utils', () => {
  it('orders slots the ESPN way', () => {
    expect(['BE', 'UTIL', 'PG', 'IR', 'C'].sort((a, b) => lineupSlotOrder(a) - lineupSlotOrder(b))).toEqual(['PG', 'C', 'UTIL', 'BE', 'IR'])
    expect(lineupSlotOrder('XX')).toBe(99)
  })

  it('formats shooting percentages', () => {
    expect(pct(7, 15)).toBe('46.67%')
    expect(pct(0, 0)).toBe('—')
  })

  it('totals starters who played and leaves bench, IR and DNPs out', () => {
    const totals = starterTotals([
      player({ player_id: 1, stats: stats(20, 8, 15) }),
      player({ player_id: 2, lineup_slot: 'UTIL', stats: stats(10, 4, 10) }),
      player({ player_id: 3, lineup_slot: 'BE', stats: stats(30, 12, 20) }),
      player({ player_id: 4, lineup_slot: 'IR', stats: stats(30, 12, 20) }),
      player({ player_id: 5, lineup_slot: 'SG', status: 'dnp', stats: null }),
    ])
    expect(totals.games).toBe(2)
    expect(totals.pts).toBe(30)
    expect([totals.fgm, totals.fga]).toEqual([12, 25])
  })

  it('describes the lock', () => {
    expect(lockNote(day({}))).toBe('Lineup at lock · 7:00 PM ET')
    expect(lockNote(day({ has_games: false, lock_at: null }))).toBe('No NBA games this day')
    const today = day({ is_today: true, lock_at: '2026-11-06T02:00:00Z' })
    expect(lockNote(today, new Date('2026-11-05T18:00:00Z'))).toBe('Live · locks 9:00 PM ET')
    expect(lockNote(today, new Date('2026-11-06T03:00:00Z'))).toBe('Live · locked 9:00 PM ET')
  })

  it('labels moves, including one made after the previous lock', () => {
    const move = { id: 'm', kind: 'free_agent' as const, at: '2026-11-05T00:52:40Z', added: [], dropped: [], after_lock: true }
    expect(moveMeta(move, '2026-11-05')).toBe('Free agent · Wed 7:52 PM · after Wed lock')
    expect(moveMeta({ ...move, kind: 'waiver', after_lock: false, at: '2026-11-03T08:42:00Z' }, '2026-11-03')).toBe('Waiver claim · Tue 3:42 AM')
  })
})

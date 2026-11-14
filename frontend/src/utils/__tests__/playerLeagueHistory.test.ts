import { describe, expect, it } from 'vitest'
import type { PlayerHistoryMove, PlayerHistoryStint } from '../../types/activity'
import { TEAM_COLORS, formatSpan, historySummary, teamColors, timelineSegments } from '../playerLeagueHistory'

const iso = (ms: number) => new Date(ms).toISOString()
const DAY = 86_400_000
const stint = (team_id: number, start: number, end: number | null): PlayerHistoryStint =>
  ({ team_id, start: iso(start), end: end === null ? null : iso(end) })
const move = (kind: PlayerHistoryMove['kind'], extra: Partial<PlayerHistoryMove> = {}): PlayerHistoryMove => ({
  id: kind, kind, at: iso(0), team_id: 1, from_team_id: null, pick: null, round: null,
  swapped: [], in_trade: false, trade_sides: [], trade_drops: [], ...extra,
})

describe('teamColors', () => {
  it('gives teams colors in the order he joined them, repeating none', () => {
    const colors = teamColors([stint(6, 0, 1), stint(8, 2, 3), stint(6, 4, 5), stint(4, 6, null)])
    expect([...colors.entries()]).toEqual([[6, TEAM_COLORS[0]], [8, TEAM_COLORS[1]], [4, TEAM_COLORS[2]]])
  })
})

describe('timelineSegments', () => {
  it('fills the gaps between stints with unrostered time up to now', () => {
    const segs = timelineSegments([stint(1, 0, 2 * DAY), stint(2, 3 * DAY, 4 * DAY)], 0, 6 * DAY)
    expect(segs.map((s) => [s.teamId, s.start / DAY, s.end / DAY, s.current])).toEqual([
      [1, 0, 2, false], [null, 2, 3, false], [2, 3, 4, false], [null, 4, 6, true],
    ])
  })

  it('runs the current team to now', () => {
    const segs = timelineSegments([stint(1, 0, null)], 0, 5 * DAY)
    expect(segs).toEqual([{ teamId: 1, start: 0, end: 5 * DAY, current: true }])
  })

  it('keeps a stint that lasted minutes', () => {
    const segs = timelineSegments([stint(1, DAY, DAY + 5 * 60_000)], 0, 2 * DAY)
    expect(segs.map((s) => s.teamId)).toEqual([null, 1, null])
  })
})

describe('formatSpan', () => {
  it.each([
    [5 * 60_000, '5 min'], [3 * 3_600_000, '3 hours'], [3_600_000, '1 hour'], [DAY, '1 day'], [11 * DAY, '11 days'],
  ])('%i ms -> %s', (ms, text) => expect(formatSpan(ms)).toBe(text))
})

describe('historySummary', () => {
  it('counts drops, trades and the longest stay', () => {
    const moves = [move('draft', { pick: 164 }), move('drop'), move('add'), move('trade'), move('drop')]
    const stints = [stint(1, 0, 11 * DAY), stint(2, 12 * DAY, 13 * DAY), stint(3, 20 * DAY, null)]
    expect(historySummary(moves, stints, 25 * DAY)).toEqual({
      draftPick: 164, teams: 3, dropped: 2, traded: 1, longestStayMs: 11 * DAY,
    })
  })
})

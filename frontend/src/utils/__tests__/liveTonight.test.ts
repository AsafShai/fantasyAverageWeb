import { describe, expect, it } from 'vitest'
import type { LiveBlock } from '../live'
import {
  changedTile, liveRaceNote, liveRangeNote, moversLegend, moversSubtitle, tonightGpPlus, topTeamsMeta,
  liveRaceSeries, LIVE_KEY_SUFFIX,
} from '../liveTonight'

const block = (over: Partial<LiveBlock> = {}): LiveBlock => ({
  active: true, period: 24, as_of: '2026-11-13T08:42:00Z',
  games_total: 4, games_live: 2, games_final: 1, official_updated_at: '2026-11-12T08:15:00Z', ...over,
})
const FINAL = block({ games_live: 0, games_final: 4 })
const IDLE = block({ active: false, as_of: null, games_live: 0, games_final: 0 })

describe('moversLegend (Rankings ▲/▼ meaning)', () => {
  it('is last night with the flag off, before tip-off and once official', () => {
    expect(moversLegend(undefined)).toBe('▲/▼ = change since last night, GP + = games played last night.')
    expect(moversLegend(IDLE)).toBe('▲/▼ = change since last night, GP + = games played last night.')
  })
  it('is tonight while live and once all final', () => {
    expect(moversLegend(block())).toBe('▲/▼ = change tonight so far, GP + = games counted tonight.')
    expect(moversLegend(FINAL)).toBe('▲/▼ = change tonight, GP + = games played tonight.')
  })
})

describe('moversSubtitle (Today Rank movers)', () => {
  it('has no line when official', () => {
    expect(moversSubtitle(undefined, 'tonight')).toBeNull()
  })
  it('follows the switch while live', () => {
    expect(moversSubtitle(block(), 'tonight')).toBe('Roto points now vs this morning’s official standings (finished games)')
    expect(moversSubtitle(FINAL, 'tonight')).toBe('Roto points after tonight vs this morning’s official standings')
    expect(moversSubtitle(block(), 'yesterday')).toBe('Roto points, latest official day vs the day before')
  })
})

describe('topTeamsMeta', () => {
  it('says change tonight only while live or final', () => {
    expect(topTeamsMeta(block())).toBe('pts · change tonight')
    expect(topTeamsMeta(FINAL)).toBe('pts · change tonight')
    expect(topTeamsMeta(IDLE)).toBeNull()
  })
})

describe('tonightGpPlus (heatmap GP column)', () => {
  it('shows +N only while live or final and only when N > 0', () => {
    expect(tonightGpPlus(block(), 2)).toBe('+2')
    expect(tonightGpPlus(FINAL, 1)).toBe('+1')
    expect(tonightGpPlus(block(), 0)).toBeNull()
    expect(tonightGpPlus(undefined, 2)).toBeNull()
    expect(tonightGpPlus(IDLE, 2)).toBeNull()
  })
})

describe('changedTile (Today league averages)', () => {
  it('marks a tile whose shown value moved tonight', () => {
    expect(changedTile(block(), '0.466', '0.465')).toBe(true)
    expect(changedTile(block(), '0.466', '0.466')).toBe(false)
    expect(changedTile(undefined, '0.466', '0.465')).toBe(false)
    expect(changedTile(block(), '0.466', undefined)).toBe(false)
  })
})

describe('liveRangeNote (ranges that end today)', () => {
  it('is null with the flag off', () => {
    expect(liveRangeNote(undefined, '2026-11-06', '2026-11-12')).toBeNull()
  })
  it('reads tonight while live', () => {
    expect(liveRangeNote(block(), '2026-11-06', '2026-11-12'))
      .toBe('Nov 6 – tonight (live). Averages count tonight’s finished games; totals include games in progress.')
  })
  it('says ESPN official is pending once all final', () => {
    expect(liveRangeNote(FINAL, '2026-11-06', '2026-11-12')).toBe('Nov 6 – Nov 12. Tonight is complete; ESPN official pending.')
  })
  it('before tip-off says when today joins', () => {
    expect(liveRangeNote(IDLE, '2026-11-05', '2026-11-11')).toBe('Nov 5 – Nov 11. Today is added once the first game starts.')
    expect(liveRangeNote({ ...IDLE, games_total: 0 }, '2026-11-05', '2026-11-11')).toBe('Nov 5 – Nov 11, all ESPN official.')
  })
})

describe('liveRaceNote', () => {
  it('explains the dashed segment only while live or final', () => {
    expect(liveRaceNote(block())).toBe('The dashed segment is tonight. It is not stored; the solid point replaces it after ESPN’s update.')
    expect(liveRaceNote(IDLE)).toBeNull()
  })
})

describe('liveRaceSeries', () => {
  const rows = [
    { date: '2026-11-10', A: 70, B: 66 },
    { date: '2026-11-11', A: 72, B: 72 },
    { date: '2026-11-12', A: 74, B: 73 },
  ]
  it('moves the live row to dashed keys that start at the last stored point', () => {
    const out = liveRaceSeries(rows, '2026-11-12', ['A', 'B'])
    expect(out[0]).toEqual({ date: '2026-11-10', A: 70, B: 66 })
    expect(out[1]).toEqual({ date: '2026-11-11', A: 72, B: 72, [`A${LIVE_KEY_SUFFIX}`]: 72, [`B${LIVE_KEY_SUFFIX}`]: 72 })
    expect(out[2]).toEqual({ date: '2026-11-12', [`A${LIVE_KEY_SUFFIX}`]: 74, [`B${LIVE_KEY_SUFFIX}`]: 73 })
  })
  it('leaves the rows alone without a live date', () => {
    expect(liveRaceSeries(rows, null, ['A', 'B'])).toBe(rows)
  })
})

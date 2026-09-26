import { describe, expect, it } from 'vitest'
import {
  effectiveWindow,
  formatMoveDelta,
  formatMoverDate,
  moversQueryArgs,
  pickSections,
  trendBadge,
  utcDaysAgo,
} from '../adpMovers'

const NOW = Date.UTC(2026, 8, 26, 22, 30) // late on Sep 26 UTC

describe('moversQueryArgs', () => {
  it('counts relative windows back in UTC days', () => {
    expect(utcDaysAgo(3, NOW)).toBe('2026-09-23')
    expect(
      moversQueryArgs({ metric: 'adp', sites: ['espn', 'yahoo'], window: '3d', top: 150, now: NOW }),
    ).toEqual({ metric: 'adp', sites: 'espn,yahoo', top: 150, mode: 'range', from_date: '2026-09-23' })
  })

  it('uses last_update mode for rankings only', () => {
    expect(moversQueryArgs({ metric: 'rank', sites: ['espn'], window: 'last_update', top: 100 })).toEqual({
      metric: 'rank',
      sites: 'espn',
      top: 100,
      mode: 'last_update',
    })
    expect(effectiveWindow('adp', 'last_update')).toBe('3d')
    expect(moversQueryArgs({ metric: 'adp', sites: ['espn'], window: 'last_update', top: 0, now: NOW })?.mode).toBe(
      'range',
    )
  })

  it('waits for a custom start date', () => {
    expect(moversQueryArgs({ metric: 'adp', sites: [], window: 'custom', top: 0 })).toBeNull()
    expect(
      moversQueryArgs({ metric: 'adp', sites: [], window: 'custom', top: 0, customFrom: '2026-09-01', customTo: '2026-09-10' }),
    ).toMatchObject({ mode: 'range', from_date: '2026-09-01', to_date: '2026-09-10' })
  })
})

describe('formatting', () => {
  it('signs deltas the way risers/fallers read', () => {
    expect(formatMoveDelta(23.4)).toBe('+23.4')
    expect(formatMoveDelta(-4)).toBe('−4')
    expect(formatMoveDelta(null)).toBe('—')
  })

  it('reads snapshot dates as calendar days', () => {
    expect(formatMoverDate('2026-09-22')).toMatch(/22/)
    expect(formatMoverDate(null)).toBe('')
  })

  it('hides zero trend badges', () => {
    expect(trendBadge(0)).toBeNull()
    expect(trendBadge(4.5)?.text).toBe('▲4.5')
    expect(trendBadge(-2)?.text).toBe('▼2')
  })
})

describe('pickSections', () => {
  const sections = [{ key: 'blend' }, { key: 'espn' }, { key: 'yahoo' }]

  it('shows one list, or all side by side on request', () => {
    expect(pickSections(sections, 'espn')).toEqual([{ key: 'espn' }])
    expect(pickSections(sections, 'all')).toEqual(sections)
  })

  it('falls back to the first list when the stored one is not in this view', () => {
    expect(pickSections([{ key: 'espn' }, { key: 'sleeper' }], 'blend')).toEqual([{ key: 'espn' }])
    expect(pickSections([], 'blend')).toEqual([])
  })
})

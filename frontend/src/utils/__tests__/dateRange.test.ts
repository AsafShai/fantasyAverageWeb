import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { daysBetween, toLocalIso, validateDateRange } from '../dateRange'

declare const process: { env: Record<string, string | undefined> }

const SEASON_START = '2025-10-22'
const TODAY = '2026-07-10'

describe('validateDateRange', () => {
  it('returns null when start or end is missing', () => {
    expect(validateDateRange('', '', SEASON_START, TODAY)).toBeNull()
    expect(validateDateRange('2025-11-01', '', SEASON_START, TODAY)).toBeNull()
    expect(validateDateRange('', '2025-11-01', SEASON_START, TODAY)).toBeNull()
  })

  it('rejects a start date before season start', () => {
    const err = validateDateRange('2025-10-01', '2025-11-01', SEASON_START, TODAY)
    expect(err).toMatch(/season start/i)
    expect(err).toContain(SEASON_START)
  })

  it('rejects an end date after today', () => {
    const err = validateDateRange('2026-01-01', '2026-08-01', SEASON_START, TODAY)
    expect(err).toMatch(/today/i)
  })

  it('rejects start >= end', () => {
    expect(validateDateRange('2026-01-10', '2026-01-05', SEASON_START, TODAY)).toMatch(/before end date/i)
    expect(validateDateRange('2026-01-10', '2026-01-10', SEASON_START, TODAY)).toMatch(/before end date/i)
  })

  it('accepts a valid range', () => {
    expect(validateDateRange('2026-01-05', '2026-02-10', SEASON_START, TODAY)).toBeNull()
  })

  it('works without a seasonStart bound', () => {
    expect(validateDateRange('2020-01-01', '2026-01-01', undefined, TODAY)).toBeNull()
  })
})

describe('toLocalIso / daysBetween (Asia/Jerusalem)', () => {
  const originalTZ = process.env.TZ

  beforeAll(() => {
    process.env.TZ = 'Asia/Jerusalem'
  })

  afterAll(() => {
    process.env.TZ = originalTZ
  })

  it('does not roll back a day for a local midnight just past UTC rollover', () => {
    const localMidnight = new Date(2026, 0, 15, 0, 30)
    expect(toLocalIso(localMidnight)).toBe('2026-01-15')
  })

  it('formats a plain local date correctly', () => {
    expect(toLocalIso(new Date(2026, 6, 4))).toBe('2026-07-04')
  })

  it('is exact across the spring-forward DST boundary', () => {
    expect(daysBetween('2026-03-25', '2026-03-30')).toBe(5)
  })

  it('is exact across the fall-back DST boundary', () => {
    expect(daysBetween('2025-10-20', '2025-10-27')).toBe(7)
  })

  it('returns 0 for the same date', () => {
    expect(daysBetween('2026-01-01', '2026-01-01')).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'
import { validateDateRange } from '../dateRange'

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

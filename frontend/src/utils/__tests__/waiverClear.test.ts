import { describe, expect, it } from 'vitest'
import { waiverClear } from '../waiverClear'

// ESPN's waiver run is 3 AM ET: 08:00Z in November (EST).
const SUN_3AM_ET = '2026-11-22T08:00:00Z'

describe('waiverClear', () => {
  it('is null for a player with no clear time', () => {
    expect(waiverClear(null)).toBeNull()
    expect(waiverClear(undefined)).toBeNull()
    expect(waiverClear('not a date')).toBeNull()
  })

  it('says tomorrow the day before, and is soon inside 24 hours', () => {
    const satEvening = new Date('2026-11-21T23:00:00Z') // Sat 6 PM ET
    expect(waiverClear(SUN_3AM_ET, satEvening)).toEqual({
      when: 'tomorrow',
      full: 'Clears waivers overnight into Sun, Nov 22',
      soon: true,
    })
  })

  it('uses the ET day, not the UTC one', () => {
    const satLateNightEt = new Date('2026-11-22T04:30:00Z') // Sat 11:30 PM ET, already Sunday in UTC
    expect(waiverClear(SUN_3AM_ET, satLateNightEt)?.when).toBe('tomorrow')
  })

  it('says today once the clear day has started', () => {
    const sunAfterMidnight = new Date('2026-11-22T05:30:00Z') // Sun 12:30 AM ET
    expect(waiverClear(SUN_3AM_ET, sunAfterMidnight)?.when).toBe('today')
  })

  it('stays today and soon when ESPN has not processed him yet', () => {
    const sunAfterRun = new Date('2026-11-22T08:40:00Z') // Sun 3:40 AM ET
    expect(waiverClear(SUN_3AM_ET, sunAfterRun)).toMatchObject({ when: 'today', soon: true })
  })

  it('names the weekday further out, and is not soon', () => {
    const fri = new Date('2026-11-20T15:00:00Z') // Fri 10 AM ET
    expect(waiverClear(SUN_3AM_ET, fri)).toMatchObject({ when: 'Sun', soon: false })
  })
})

import { describe, expect, it } from 'vitest'
import { waiverClear } from '../waiverClear'

// Every date here is built in the runner's own time zone, the same way the
// helper reads them, so the expectations hold wherever the suite runs.
const local = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute)
const SUN_10AM = local(22, 10).toISOString() // a Sunday clear time

describe('waiverClear', () => {
  it('is null for a player with no clear time', () => {
    expect(waiverClear(null)).toBeNull()
    expect(waiverClear(undefined)).toBeNull()
    expect(waiverClear('not a date')).toBeNull()
  })

  it('says tomorrow the day before, and is soon inside 24 hours', () => {
    expect(waiverClear(SUN_10AM, local(21, 18))).toEqual({
      when: 'tomorrow',
      full: 'Clears waivers on Sun, Nov 22',
      soon: true,
    })
  })

  it('switches to today at the viewer\'s own midnight', () => {
    expect(waiverClear(SUN_10AM, local(21, 23, 59))?.when).toBe('tomorrow')
    expect(waiverClear(SUN_10AM, local(22, 0, 1))?.when).toBe('today')
  })

  it('stays today and soon when ESPN has not processed him yet', () => {
    expect(waiverClear(SUN_10AM, local(22, 11))).toMatchObject({ when: 'today', soon: true })
  })

  it('names the weekday further out, and is not soon', () => {
    expect(waiverClear(SUN_10AM, local(20, 9))).toMatchObject({ when: 'Sun', soon: false })
  })

  it('is tomorrow across a month boundary', () => {
    const dec1 = new Date(2026, 11, 1, 10).toISOString()
    expect(waiverClear(dec1, local(30, 20))?.when).toBe('tomorrow')
  })
})

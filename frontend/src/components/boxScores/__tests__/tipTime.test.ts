import { describe, expect, it } from 'vitest'
import { countdownLabel, formatLocalTip, gameClockLabel } from '../tipTime'

describe('formatLocalTip', () => {
  it('shows an Eastern tip as the same-day clock', () => {
    expect(formatLocalTip('2026-10-26T23:00Z', 'America/New_York')).toBe('7:00 PM')
  })

  it('moves a late Eastern tip to the next morning in Israel', () => {
    expect(formatLocalTip('2026-10-26T23:00Z', 'Asia/Jerusalem')).toBe('Tue, Oct 27, 1:00 AM')
  })

  it('counts down to the second, and says when tip has passed', () => {
    const tip = '2026-10-26T23:00:00Z'
    const now = new Date('2026-10-26T20:00:00Z').getTime()
    expect(countdownLabel(tip, now)).toBe('03:00:00')
    expect(countdownLabel(tip, new Date('2026-10-25T20:00:00Z').getTime())).toBe('1d 03:00:00')
    expect(countdownLabel(tip, new Date('2026-10-26T23:00:01Z').getTime())).toBe('Starting soon')
    expect(countdownLabel('', now)).toBeNull()
  })

  it('keeps final labels and falls back when the tip is missing', () => {
    expect(gameClockLabel('final', 'Final', '2026-10-26T23:00Z')).toBe('Final')
    expect(gameClockLabel('scheduled', '10/26 - 7:00 PM EDT', '')).toBe('10/26 - 7:00 PM EDT')
  })
})

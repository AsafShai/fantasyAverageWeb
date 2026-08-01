import { describe, it, expect } from 'vitest'
import {
  projectSlot,
  rateTone,
  formatRateDelta,
  maxTone,
  estimatedTone,
  canColor,
  formatCap,
  formatSlotNumber,
  slotCeiling,
  SLOT_CAPS,
  GAMES_PER_SLOT,
} from '../slotProjection'

const midSeason = { avgPace: 41, gameDaysLeft: 80 }

describe('slotCeiling', () => {
  it('is 82 for single slots', () => {
    expect(slotCeiling('PG')).toBe(82)
  })

  it('spreads the UTIL cap of 248 over three slots', () => {
    expect(SLOT_CAPS.UTIL).toBe(248)
    expect(slotCeiling('UTIL')).toBeCloseTo(248 / 3, 6)
  })
})

describe('projectSlot', () => {
  it('normalises UTIL games to a single slot', () => {
    const { used } = projectSlot(120, 'UTIL', midSeason)
    expect(used).toBe(40)
  })

  it('leaves single slots as-is', () => {
    const { used } = projectSlot(40, 'PG', midSeason)
    expect(used).toBe(40)
  })

  it('reports rate as games used per NBA game elapsed', () => {
    const { rate } = projectSlot(41, 'PG', midSeason)
    expect(rate).toBeCloseTo(1, 6)
  })

  it('flags a slot that is behind with a rate under 1', () => {
    const { rate } = projectSlot(30, 'PG', midSeason)
    expect(rate).toBeCloseTo(30 / 41, 6)
  })

  it('caps max games at the slot ceiling', () => {
    const { maxGames } = projectSlot(40, 'PG', { avgPace: 41, gameDaysLeft: 80 })
    expect(maxGames).toBe(82)
  })

  it('reports a max under 82 once game days run short', () => {
    const { maxGames } = projectSlot(40, 'PG', { avgPace: 41, gameDaysLeft: 30 })
    expect(maxGames).toBe(70)
  })

  it('counts UTIL max across all three slots, capped at 248', () => {
    const { maxGamesTotal } = projectSlot(120, 'UTIL', { avgPace: 41, gameDaysLeft: 80 })
    expect(maxGamesTotal).toBe(248)
  })

  it('gains three UTIL games per remaining game day', () => {
    const { maxGamesTotal } = projectSlot(120, 'UTIL', { avgPace: 41, gameDaysLeft: 30 })
    expect(maxGamesTotal).toBe(120 + 30 * 3)
  })

  it('leaves single-slot max totals on the 82 scale', () => {
    const { maxGamesTotal } = projectSlot(40, 'PG', { avgPace: 41, gameDaysLeft: 30 })
    expect(maxGamesTotal).toBe(70)
  })

  it('matches the backend blend formula', () => {
    const used = 40
    const avgPace = 41
    const daysLeft = 41
    const m1 = Math.min(used * (82 / avgPace), 82)
    const m2 = Math.min(used + (used / avgPace) * daysLeft, 82)
    const w2 = avgPace / 82
    const expected = (1 - w2) * m1 + w2 * m2

    const { estimated } = projectSlot(used, 'PG', { avgPace, gameDaysLeft: daysLeft })
    expect(estimated).toBeCloseTo(expected, 6)
  })

  it('rounds an estimate of 81.7 up to a full 82', () => {
    const ctx = { avgPace: 41.3, gameDaysLeft: 82 }
    const { estimated, estimatedRounded } = projectSlot(41, 'PG', ctx)
    expect(estimated).toBeCloseTo(81.7, 1)
    expect(estimatedRounded).toBe(82)
  })

  it('rounds an estimate of 81.1 down to 81', () => {
    const ctx = { avgPace: 60.4, gameDaysLeft: 44 }
    const { estimated, estimatedRounded } = projectSlot(58, 'PG', ctx)
    expect(estimated).toBeCloseTo(81.1, 1)
    expect(estimatedRounded).toBe(81)
  })

  it('grades the rounded estimate, so 81.7 counts as a full season', () => {
    const ctx = { avgPace: 41.3, gameDaysLeft: 82 }
    const { estimatedRounded } = projectSlot(41, 'PG', ctx)
    expect(estimatedTone(estimatedRounded, 'PG', ctx)).toBe('green')
  })

  it('still grades 81.1 as short of a full season', () => {
    const ctx = { avgPace: 60.4, gameDaysLeft: 44 }
    const { estimatedRounded } = projectSlot(58, 'PG', ctx)
    expect(estimatedTone(estimatedRounded, 'PG', ctx)).toBe('yellow')
  })

  it('projects UTIL as a whole column, capped at 248', () => {
    const { estimated, estimatedPerSlot } = projectSlot(248, 'UTIL', { avgPace: 80, gameDaysLeft: 20 })
    expect(estimated).toBeCloseTo(248, 6)
    expect(estimatedPerSlot).toBeCloseTo(248 / 3, 6)
    expect(estimated!).toBeGreaterThan(GAMES_PER_SLOT)
  })

  it('matches the backend UTIL projection, which works on the 248 cap', () => {
    const usedTotal = 120
    const avgPace = 41
    const daysLeft = 41
    const m1 = Math.min(usedTotal * (82 / avgPace), 248)
    const m2 = Math.min(usedTotal + (usedTotal / avgPace) * daysLeft, 248)
    const w2 = avgPace / 82
    const expected = (1 - w2) * m1 + w2 * m2

    const { estimated } = projectSlot(usedTotal, 'UTIL', { avgPace, gameDaysLeft: daysLeft })
    expect(estimated).toBeCloseTo(expected, 6)
  })

  it('returns nulls when pace is unavailable', () => {
    const p = projectSlot(40, 'PG', { avgPace: null, gameDaysLeft: 40 })
    expect(p.rate).toBeNull()
    expect(p.maxGames).toBeNull()
    expect(p.estimated).toBeNull()
  })

  it('returns nulls when pace is zero', () => {
    const p = projectSlot(40, 'PG', { avgPace: 0, gameDaysLeft: 40 })
    expect(p.estimated).toBeNull()
  })

  it('falls back to pace extrapolation when game days are unknown', () => {
    const { estimated, maxGames } = projectSlot(40, 'PG', { avgPace: 41, gameDaysLeft: null })
    expect(maxGames).toBeNull()
    expect(estimated).toBeCloseTo(80, 6)
  })
})

describe('canColor', () => {
  it('stays off while the season is young', () => {
    expect(canColor({ avgPace: 8, gameDaysLeft: 120 })).toBe(false)
    expect(canColor({ avgPace: 10, gameDaysLeft: 120 })).toBe(false)
  })

  it('turns on past 10 games per team', () => {
    expect(canColor({ avgPace: 11, gameDaysLeft: 120 })).toBe(true)
  })

  it('stays off without a pace', () => {
    expect(canColor({ avgPace: null, gameDaysLeft: 120 })).toBe(false)
  })
})

describe('rateTone', () => {
  it('is green inside the 5% band, either way', () => {
    expect(rateTone(1.02, midSeason)).toBe('green')
    expect(rateTone(0.98, midSeason)).toBe('green')
  })

  it('grades a slot burning games too fast by how far off it is', () => {
    expect(rateTone(1.06, midSeason)).toBe('yellow')
    expect(rateTone(1.12, midSeason)).toBe('orange')
    expect(rateTone(1.2, midSeason)).toBe('red')
  })

  it('grades a slot falling behind the same way', () => {
    expect(rateTone(0.94, midSeason)).toBe('yellow')
    expect(rateTone(0.88, midSeason)).toBe('orange')
    expect(rateTone(0.8, midSeason)).toBe('red')
  })

  it('stays neutral early in the season', () => {
    expect(rateTone(1.5, { avgPace: 6, gameDaysLeft: 140 })).toBe('neutral')
    expect(rateTone(0.2, { avgPace: 6, gameDaysLeft: 140 })).toBe('neutral')
  })
})

describe('formatRateDelta', () => {
  it('counts the games behind the NBA rate', () => {
    expect(formatRateDelta(69, 69.3)).toBe('−0.3')
  })

  it('counts the games ahead of it', () => {
    expect(formatRateDelta(74, 69.6)).toBe('+4.4')
  })

  it('says so when the slot sits on the rate', () => {
    expect(formatRateDelta(69.3, 69.3)).toBe('on pace')
  })

  it('renders a dash without a rate', () => {
    expect(formatRateDelta(40, null)).toBe('-')
  })

  it('leaves the colour to rateTone, which still grades in percent', () => {
    // 69 against 69.3 is only 0.4% off, so it stays green despite the visible −0.3.
    expect(rateTone(69 / 69.3, { avgPace: 69.3, gameDaysLeft: 25 })).toBe('green')
  })
})

describe('maxTone', () => {
  it('is green while the full column is still reachable', () => {
    expect(maxTone(82, 'PG', midSeason)).toBe('green')
  })

  it('is red once the column can no longer be filled', () => {
    expect(maxTone(81.5, 'PG', midSeason)).toBe('red')
  })

  it('judges UTIL against 248, not 82', () => {
    expect(maxTone(248, 'UTIL', midSeason)).toBe('green')
    expect(maxTone(247, 'UTIL', midSeason)).toBe('red')
    expect(maxTone(90, 'UTIL', midSeason)).toBe('red')
  })

  it('only ever returns green or red', () => {
    for (const value of [0, 40, 82, 200]) {
      expect(['green', 'red']).toContain(maxTone(value, 'PG', midSeason))
    }
  })

  it('stays neutral early in the season', () => {
    expect(maxTone(40, 'PG', { avgPace: 6, gameDaysLeft: 140 })).toBe('neutral')
  })
})

describe('estimatedTone', () => {
  it('is green at 82 and above', () => {
    expect(estimatedTone(82, 'PG', midSeason)).toBe('green')
    expect(estimatedTone(82.6, 'PG', midSeason)).toBe('green')
  })

  it('is yellow between 80 and 82', () => {
    expect(estimatedTone(81.9, 'PG', midSeason)).toBe('yellow')
    expect(estimatedTone(80, 'PG', midSeason)).toBe('yellow')
  })

  it('is orange between 78 and 80', () => {
    expect(estimatedTone(79.9, 'PG', midSeason)).toBe('orange')
    expect(estimatedTone(78, 'PG', midSeason)).toBe('orange')
  })

  it('is red under 78', () => {
    expect(estimatedTone(77.9, 'PG', midSeason)).toBe('red')
  })

  it('scales every band by three for UTIL', () => {
    expect(estimatedTone(246, 'UTIL', midSeason)).toBe('green')
    expect(estimatedTone(245, 'UTIL', midSeason)).toBe('yellow')
    expect(estimatedTone(239, 'UTIL', midSeason)).toBe('orange')
    expect(estimatedTone(233, 'UTIL', midSeason)).toBe('red')
  })

  it('does not read a full UTIL column as a failing single slot', () => {
    expect(estimatedTone(248, 'UTIL', midSeason)).toBe('green')
  })

  it('stays neutral early in the season', () => {
    expect(estimatedTone(20, 'PG', { avgPace: 6, gameDaysLeft: 140 })).toBe('neutral')
  })
})

describe('formatCap', () => {
  it('is a plain 82 for single slots', () => {
    expect(formatCap('PG')).toBe('82')
  })

  it('splits the UTIL cap so the two spare ESPN games stay visible', () => {
    expect(formatCap('UTIL')).toBe('(246+2)')
  })
})

describe('formatSlotNumber', () => {
  it('keeps whole numbers clean', () => {
    expect(formatSlotNumber(82)).toBe('82')
  })

  it('rounds fractions to one place', () => {
    expect(formatSlotNumber(82.666)).toBe('82.7')
  })

  it('renders a dash for missing values', () => {
    expect(formatSlotNumber(null)).toBe('-')
  })
})

import { describe, it, expect } from 'vitest'
import {
  projectSlot,
  slotStatus,
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

  it('returns nulls when pace is unavailable, but still knows the ceiling', () => {
    const p = projectSlot(40, 'PG', { avgPace: null, gameDaysLeft: 40 })
    expect(p.rate).toBeNull()
    expect(p.estimated).toBeNull()
    expect(p.maxGames).toBe(80)
    expect(p.maxGamesTotal).toBe(80)
  })

  it('returns nulls when pace is zero', () => {
    const p = projectSlot(40, 'PG', { avgPace: 0, gameDaysLeft: 40 })
    expect(p.estimated).toBeNull()
  })

  it('falls back to pace extrapolation when game days are unknown', () => {
    const { estimated } = projectSlot(40, 'PG', { avgPace: 41, gameDaysLeft: null })
    expect(estimated).toBeCloseTo(80, 6)
  })

  it('treats the whole cap as reachable while the remaining game days are unknown', () => {
    const p = projectSlot(40, 'PG', { avgPace: 41, gameDaysLeft: null })
    expect(p.maxGames).toBe(82)
    expect(p.maxGamesTotal).toBe(82)
    expect(projectSlot(120, 'UTIL', { avgPace: 41, gameDaysLeft: null }).maxGamesTotal).toBe(248)
  })
})

describe('slotStatus', () => {
  const status = (used: number, slot: Parameters<typeof projectSlot>[1], ctx: typeof midSeason) =>
    slotStatus(projectSlot(used, slot, ctx), slot, ctx)

  it('says nothing at all for a slot on pace with a full season reachable', () => {
    const ctx = { avgPace: 60, gameDaysLeft: 22 }
    expect(status(60, 'PG', ctx)).toEqual({ behindPace: null, short: null, lost: null })
  })

  it('reports any gap that rounds to a whole game behind pace', () => {
    const ctx = { avgPace: 60, gameDaysLeft: 22 }
    expect(status(60, 'PG', ctx).behindPace).toBeNull()
    expect(status(59.6, 'PG', ctx).behindPace).toBeNull()
    expect(status(59, 'PG', ctx).behindPace).toBe(1)
    expect(status(48, 'PG', ctx).behindPace).toBe(12)
  })

  it('never reports being ahead of pace', () => {
    expect(status(70, 'PG', { avgPace: 60, gameDaysLeft: 22 }).behindPace).toBeNull()
  })

  it('measures behindPace per slot, so UTIL is comparable with the rest', () => {
    const ctx = { avgPace: 60, gameDaysLeft: 22 }
    expect(status(180, 'UTIL', ctx).behindPace).toBeNull()
    expect(status(150, 'UTIL', ctx).behindPace).toBe(10)
  })

  it('counts lost games against the whole column cap', () => {
    const ctx = { avgPace: 60, gameDaysLeft: 12 }
    expect(status(48, 'PG', ctx).lost).toBe(22)
    expect(status(82, 'PG', ctx).lost).toBeNull()
  })

  it('rounds the projection before calling it short, so 81.7 is a full season', () => {
    expect(status(41, 'PG', { avgPace: 41.3, gameDaysLeft: 82 }).short).toBeNull()
    expect(status(58, 'PG', { avgPace: 60.4, gameDaysLeft: 44 }).short).toBe(1)
  })

  it('stays silent while the season is too young to judge', () => {
    expect(status(2, 'PG', { avgPace: 6, gameDaysLeft: 140 }))
      .toEqual({ behindPace: null, short: null, lost: null })
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

describe('formatCap', () => {
  it('is a plain 82 for single slots', () => {
    expect(formatCap('PG')).toBe('82')
  })

  it('keeps the two spare ESPN games visible on the UTIL cap', () => {
    expect(formatCap('UTIL')).toBe('246+2')
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

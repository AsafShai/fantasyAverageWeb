import { describe, expect, it } from 'vitest'
import { averagesNote, liveBadgeText, liveMoment, livePollMs, type LiveBlock } from '../live'

const block = (over: Partial<LiveBlock> = {}): LiveBlock => ({
  active: true, period: 24, as_of: '2026-11-13T08:42:00Z',
  games_total: 4, games_live: 2, games_final: 1, official_updated_at: '2026-11-12T08:15:00Z', ...over,
})

describe('liveMoment', () => {
  it('is null when the block is absent (flag off) or inactive', () => {
    expect(liveMoment(undefined)).toBeNull()
    expect(liveMoment(null)).toBeNull()
    expect(liveMoment(block({ active: false, as_of: null, games_live: 0, games_final: 0 }))).toBeNull()
  })
  it('is live while any game is in progress', () => {
    expect(liveMoment(block())).toBe('live')
  })
  it('is live between games when some have not finished', () => {
    expect(liveMoment(block({ games_live: 0, games_final: 2 }))).toBe('live')
  })
  it('is final once every game is final', () => {
    expect(liveMoment(block({ games_live: 0, games_final: 4 }))).toBe('final')
  })
})

describe('livePollMs', () => {
  it('polls every 60 s only while games are in progress', () => {
    expect(livePollMs(block())).toBe(60_000)
    expect(livePollMs(block({ games_live: 0, games_final: 4 }))).toBe(0)
    expect(livePollMs(block({ active: false, games_live: 0 }))).toBe(0)
    expect(livePollMs(undefined)).toBe(0)
  })
})

describe('liveBadgeText', () => {
  it('describes games in progress', () => {
    expect(liveBadgeText(block())).toBe('2 of 4 games in progress')
  })
  it('says official is pending when all are final', () => {
    expect(liveBadgeText(block({ games_live: 0, games_final: 4 }))).toBe('all 4 games counted · ESPN official pending')
  })
  it('has a short form for mobile', () => {
    expect(liveBadgeText(block(), true)).toBe('2 of 4')
    expect(liveBadgeText(block({ games_live: 0, games_final: 4 }), true)).toBe('4 of 4')
  })
})

describe('averagesNote', () => {
  it('explains averages count finished games only', () => {
    expect(averagesNote(block(), 'averages')).toBe('Averages count finished games only. 2 games in progress are added when they go final.')
  })
  it('explains totals include games in progress', () => {
    expect(averagesNote(block(), 'totals')).toBe('Totals include the 2 games still in progress.')
  })
  it('is null when nothing is in progress', () => {
    expect(averagesNote(block({ games_live: 0, games_final: 4 }), 'averages')).toBeNull()
    expect(averagesNote(undefined, 'averages')).toBeNull()
  })
  it('uses singular for one game', () => {
    expect(averagesNote(block({ games_live: 1 }), 'totals')).toBe('Totals include the 1 game still in progress.')
  })
})

import { liveShare } from '../live'

describe('averagesNote on a phone', () => {
  it('uses the phone sheet wording', () => {
    expect(averagesNote(block(), 'averages', true)).toBe('Averages count finished games only. 2 games still in progress.')
    expect(averagesNote(block(), 'totals', true)).toBe('Totals include the 2 games in progress.')
  })
})

describe('liveBadgeText for the heatmap', () => {
  it('says finished games are counted instead of the update time', () => {
    expect(liveBadgeText(block(), false, 'finished')).toBe('2 of 4 games in progress · finished games counted')
  })
})

describe('liveShare footer', () => {
  it('says when a live card is as of and that a final card counted tonight', () => {
    expect(liveShare(block())!.footer).toMatch(/^Live as of \w{3} \w{3} \d+, /)
    expect(liveShare(block({ games_live: 0, games_final: 4 }))!.footer).toMatch(/^Tonight counted, \w{3} \w{3} \d+$/)
  })
})

describe('liveShare', () => {
  it('stamps a live card with the time and says how many games are in progress', () => {
    const s = liveShare(block())!
    expect(s.tone).toBe('live')
    expect(s.stamp).toMatch(/^LIVE · /)
    expect(s.subtitle).toBe('Live standings · 2 of 4 games still in progress')
  })
  it('stamps a final card as not yet official', () => {
    const s = liveShare(block({ games_live: 0, games_final: 4 }))!
    expect(s.tone).toBe('final')
    expect(s.stamp).toBe('FINAL · NOT YET OFFICIAL')
    expect(s.subtitle).toBe('Includes all of tonight’s games · ESPN official pending')
  })
  it('is null when nothing is live', () => {
    expect(liveShare(undefined)).toBeNull()
    expect(liveShare(block({ active: false }))).toBeNull()
  })
})

import { liveSectionNote } from '../live'

describe('liveSectionNote', () => {
  it('says what team statistics count while live and when final', () => {
    expect(liveSectionNote(block(), 'stats')).toBe('live, finished games counted')
    expect(liveSectionNote(block({ games_live: 0, games_final: 4 }), 'stats')).toBe('includes tonight, ESPN official pending')
  })
  it('says slot usage includes games in progress', () => {
    expect(liveSectionNote(block(), 'slots')).toBe('includes 2 games in progress')
    expect(liveSectionNote(block({ games_live: 1 }), 'slots')).toBe('includes 1 game in progress')
    expect(liveSectionNote(block({ games_live: 0, games_final: 4 }), 'slots')).toBe('includes tonight, ESPN official pending')
  })
  it('is null when not live', () => {
    expect(liveSectionNote(undefined, 'stats')).toBeNull()
    expect(liveSectionNote(block({ active: false }), 'slots')).toBeNull()
  })
})

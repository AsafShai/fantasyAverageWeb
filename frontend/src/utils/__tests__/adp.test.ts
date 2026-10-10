import { describe, expect, it } from 'vitest'
import {
  annotateDraftPicks,
  blendRankValue,
  blendSitesParam,
  blendValue,
  clampLeagueSettings,
  DEFAULT_DRAFT_METRIC,
  draftTeamForPick,
  equalWeights,
  evenSplitLabel,
  isEvenSplit,
  paramSites,
  rebalanceWeights,
  roundedWeights,
  groupDraftPicksByTeam,
  isThreeRrReverse,
  nextShortSeasonLabel,
  shortSeasonLabel,
  siteValue,
  sitesForMetric,
  spreadValue,
  threeRrDisplayRounds,
  toListHeadshotUrl,
  weightsTotal,
  withIndexBlends,
} from '../adp'
import type { AdpIndexPlayer, AdpPlayer, ProviderMeta } from '../../types/api'

describe('3RR draft board', () => {
  it('reverses rounds 2 and 3, then snakes from there', () => {
    expect([0, 1, 2, 3, 4, 5].map(isThreeRrReverse)).toEqual([
      false,
      true,
      true,
      false,
      true,
      false,
    ])
  })

  it('maps overall pick to the 12-team slot', () => {
    expect(draftTeamForPick(1, 12)).toBe(1)
    expect(draftTeamForPick(12, 12)).toBe(12)
    expect(draftTeamForPick(13, 12)).toBe(12)
    expect(draftTeamForPick(24, 12)).toBe(1)
    expect(draftTeamForPick(25, 12)).toBe(12)
    expect(draftTeamForPick(36, 12)).toBe(1)
    expect(draftTeamForPick(37, 12)).toBe(1)
    expect(draftTeamForPick(48, 12)).toBe(12)
  })

  it('groups a team roster by overall pick', () => {
    const picks = annotateDraftPicks(Array.from({ length: 36 }, (_, i) => i + 1), 12)
    const teams = groupDraftPicksByTeam(picks, 12)
    expect(teams[10].picks.map((p) => p.pick)).toEqual([11, 14, 26])
  })

  it('shows every round in pick order, including reverse rounds', () => {
    const picks = annotateDraftPicks(Array.from({ length: 24 }, (_, i) => i + 1), 12)
    const rounds = threeRrDisplayRounds(picks, 12)
    expect(rounds[0].map((p) => p.pick)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1))
    expect(rounds[1].map((p) => p.pick)).toEqual(Array.from({ length: 12 }, (_, i) => i + 13))
    expect(rounds[1][0].team).toBe(12)
    expect(rounds[1][11].team).toBe(1)
  })

  it('uses a regular snake when 3RR is off', () => {
    expect(draftTeamForPick(13, 12, false)).toBe(12)
    expect(draftTeamForPick(24, 12, false)).toBe(1)
    expect(draftTeamForPick(25, 12, false)).toBe(1)
    expect(draftTeamForPick(36, 12, false)).toBe(12)
  })

  it('clamps league settings to supported ranges', () => {
    expect(clampLeagueSettings({ teams: 3, rounds: 40, threeRr: false })).toEqual({
      teams: 8,
      rounds: 15,
      threeRr: false,
    })
    expect(clampLeagueSettings(null)).toEqual({
      teams: 12,
      rounds: 15,
      threeRr: true,
    })
  })
})

describe('season labels', () => {
  it('shortens 2025-26 to 25/26', () => {
    expect(shortSeasonLabel('2025-26')).toBe('25/26')
    expect(nextShortSeasonLabel('2025-26')).toBe('26/27')
  })
})

describe('provider capabilities', () => {
  const providers: ProviderMeta[] = [
    { key: 'espn', label: 'ESPN', has_adp: true, has_rankings: true, fetched_at: null, source_url: null, player_count: 0, stale: false },
    { key: 'fantrax', label: 'Fantrax', has_adp: true, has_rankings: false, fetched_at: null, source_url: null, player_count: 0, stale: false },
    { key: 'sleeper', label: 'Sleeper', has_adp: false, has_rankings: true, fetched_at: null, source_url: null, player_count: 0, stale: false },
  ]

  it('shows a site only on the view it has data for', () => {
    expect(sitesForMetric('adp', providers)).toEqual(['espn', 'fantrax'])
    expect(sitesForMetric('rank', providers)).toEqual(['espn', 'sleeper'])
  })

  it('drops a provider the server stopped returning', () => {
    expect(sitesForMetric('adp', [providers[1]])).toEqual(['fantrax'])
  })

  it('falls back to the static matrix before the first response', () => {
    expect(sitesForMetric('adp')).toEqual(['espn', 'fantrax', 'yahoo'])
    expect(sitesForMetric('rank')).toEqual(['espn', 'sleeper', 'yahoo'])
  })
})

describe('metric-aware player values', () => {
  it('defaults draft pages to rankings blend, not ADP', () => {
    expect(DEFAULT_DRAFT_METRIC).toBe('rank')
  })

  const player = {
    espn: { adp: 12.5, rank: 9, ranking: 4 },
    blend: 12.5,
    blend_rank: 11,
    spread: 3,
    ranking_blend: 4,
    ranking_blend_rank: 5,
    ranking_spread: 1,
  } as AdpPlayer

  it('reads ADP and rankings from separate fields', () => {
    expect(siteValue(player, 'espn', 'adp')).toBe(12.5)
    expect(siteValue(player, 'espn', 'rank')).toBe(4)
    expect(blendValue(player, 'adp')).toBe(12.5)
    expect(blendValue(player, 'rank')).toBe(4)
    expect(blendRankValue(player, 'adp')).toBe(11)
    expect(blendRankValue(player, 'rank')).toBe(5)
    expect(spreadValue(player, 'adp')).toBe(3)
    expect(spreadValue(player, 'rank')).toBe(1)
  })

  it('keeps the site-filtered index blends over the all-sites detail record', () => {
    const index = {
      id: 'tari-eason',
      blend: 116.5,
      blend_rank: 110,
      ranking_blend: 90,
      ranking_blend_rank: 88,
    } as AdpIndexPlayer
    const detail = { ...player, id: 'tari-eason', blend: 127.9, blend_rank: 121 } as AdpPlayer
    const merged = withIndexBlends(detail, index)
    expect(merged.blend).toBe(116.5)
    expect(merged.blend_rank).toBe(110)
    expect(merged.ranking_blend).toBe(90)
    expect(merged.ranking_blend_rank).toBe(88)
    expect(merged.espn).toBe(detail.espn)
    expect(withIndexBlends(merged, index)).toBe(merged)
  })
})

describe('list headshots', () => {
  it('shrinks ESPN full headshots for list avatars', () => {
    expect(toListHeadshotUrl('https://a.espncdn.com/i/headshots/nba/players/full/3112335.png')).toBe(
      'https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/3112335.png&w=96&h=70',
    )
    expect(toListHeadshotUrl(null)).toBeNull()
    expect(toListHeadshotUrl('https://example.com/photo.png')).toBe('https://example.com/photo.png')
  })
})

describe('weighted blend sites', () => {
  it('splits 100 evenly in whole percents', () => {
    expect(equalWeights(['espn', 'yahoo'])).toEqual({ espn: 50, yahoo: 50 })
    expect(equalWeights(['espn', 'fantrax', 'yahoo'])).toEqual({ espn: 34, fantrax: 33, yahoo: 33 })
    expect(equalWeights([])).toEqual({})
  })

  it('totals only the checked sites', () => {
    expect(weightsTotal(['espn', 'yahoo'], { espn: 60, yahoo: 30, fantrax: 10 })).toBe(90)
  })

  it('keeps the total at 100 when one site changes', () => {
    const sites = ['espn', 'sleeper', 'yahoo'] as const
    expect(rebalanceWeights([...sites], { espn: 34, sleeper: 33, yahoo: 33 }, 'espn', 50)).toEqual({
      espn: 50,
      sleeper: 25,
      yahoo: 25,
    })
    // The others keep their proportions.
    expect(rebalanceWeights([...sites], { espn: 20, sleeper: 60, yahoo: 20 }, 'espn', 60)).toEqual({
      espn: 60,
      sleeper: 30,
      yahoo: 10,
    })
    // Others all at 0: they share the rest evenly.
    expect(rebalanceWeights([...sites], { espn: 100, sleeper: 0, yahoo: 0 }, 'espn', 40)).toEqual({
      espn: 40,
      sleeper: 30,
      yahoo: 30,
    })
    const odd = rebalanceWeights([...sites], { espn: 34, sleeper: 33, yahoo: 33 }, 'yahoo', 33)
    expect(Object.values(odd).reduce((a, b) => a + (b ?? 0), 0)).toBeCloseTo(100)
    expect(rebalanceWeights(['espn'], {}, 'espn', 40)).toEqual({ espn: 100 })
  })

  it('keeps proportions over many small steps', () => {
    const sites = ['espn', 'sleeper', 'yahoo'] as const
    let weights = { espn: 100, sleeper: 0, yahoo: 0 } as Parameters<typeof rebalanceWeights>[1]
    for (let v = 95; v >= 60; v -= 5) weights = rebalanceWeights([...sites], weights, 'espn', v)
    expect(weights.sleeper).toBeCloseTo(20)
    expect(weights.yahoo).toBeCloseTo(20)
  })

  it('rounds for display without losing the 100 total', () => {
    expect(roundedWeights(['espn', 'sleeper', 'yahoo'], { espn: 100 / 3, sleeper: 100 / 3, yahoo: 100 / 3 })).toEqual({
      espn: 34,
      sleeper: 33,
      yahoo: 33,
    })
    expect(roundedWeights(['espn', 'yahoo'], { espn: 62.5, yahoo: 37.5 })).toEqual({ espn: 63, yahoo: 37 })
  })

  it('leaves locked sites where they are', () => {
    const sites = ['espn', 'sleeper', 'yahoo'] as const
    const start = { espn: 50, sleeper: 30, yahoo: 20 }
    // ESPN locked: only Yahoo moves when Sleeper does.
    expect(rebalanceWeights([...sites], start, 'sleeper', 40, ['espn'])).toEqual({ espn: 50, sleeper: 40, yahoo: 10 })
    // Capped at what the locked site leaves free.
    expect(rebalanceWeights([...sites], start, 'sleeper', 80, ['espn'])).toEqual({ espn: 50, sleeper: 50, yahoo: 0 })
    // Nothing free to trade with: the site keeps the rest of 100.
    expect(rebalanceWeights([...sites], start, 'sleeper', 10, ['espn', 'yahoo'])).toEqual({
      espn: 50,
      sleeper: 30,
      yahoo: 20,
    })
  })

  it('labels an even split exactly', () => {
    expect(evenSplitLabel(2)).toBe('50')
    expect(evenSplitLabel(3)).toBe('33⅓')
    expect(evenSplitLabel(4)).toBe('25')
  })

  it('treats a split no more than 1 apart as even', () => {
    expect(isEvenSplit(['espn', 'sleeper', 'yahoo'], { espn: 34, sleeper: 33, yahoo: 33 })).toBe(true)
    expect(isEvenSplit(['espn', 'sleeper', 'yahoo'], { espn: 35, sleeper: 33, yahoo: 32 })).toBe(false)
    expect(isEvenSplit(['espn', 'yahoo'], { espn: 50, yahoo: 50 })).toBe(true)
  })

  it('reads the sites out of a weighted param', () => {
    expect(paramSites('espn:60,yahoo:40')).toBe('espn,yahoo')
    expect(paramSites('espn,yahoo')).toBe('espn,yahoo')
  })

  it('encodes weights into the sites param', () => {
    expect(blendSitesParam(['espn', 'yahoo'])).toBe('espn,yahoo')
    expect(blendSitesParam(['espn', 'yahoo'], null)).toBe('espn,yahoo')
    expect(blendSitesParam(['espn', 'yahoo'], { espn: 70 })).toBe('espn:70,yahoo:0')
    expect(blendSitesParam(['espn', 'yahoo'], { espn: 100 / 3, yahoo: 200 / 3 })).toBe('espn:33.33,yahoo:66.67')
  })
})

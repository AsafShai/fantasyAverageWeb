import { describe, expect, it } from 'vitest'
import {
  annotateDraftPicks,
  blendRankValue,
  blendValue,
  clampLeagueSettings,
  DEFAULT_DRAFT_METRIC,
  draftTeamForPick,
  groupDraftPicksByTeam,
  isThreeRrReverse,
  nextShortSeasonLabel,
  shortSeasonLabel,
  siteValue,
  sitesForMetric,
  spreadValue,
  threeRrDisplayRounds,
} from '../adp'
import type { AdpPlayer, ProviderMeta } from '../../types/api'

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
    expect(clampLeagueSettings(null).threeRr).toBe(true)
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
})

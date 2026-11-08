import { describe, expect, it } from 'vitest'
import type { Player } from '../../../types/api'
import { normalizePlayerName } from '../../../utils/playerName'
import { detectLineupHints } from '../detectors/lineup'
import type { RankLookups } from '../types'
import { minimalRosterDay, minimalTeamDetail } from './fixtures'

function p(id: number, name: string, slot: string): Player {
  return {
    player_id: id,
    player_name: name,
    pro_team: 'LAL',
    positions: ['C'],
    lineup_slot: slot,
    stats: { gp: 20, minutes: 400, pts: 10, reb: 5, ast: 1, stl: 0, blk: 1, fgm: 1, fga: 2, ftm: 1, fta: 1, fg_percentage: 0.5, ft_percentage: 0.5, three_pm: 0 },
    team_id: 1,
    status: 'ONTEAM',
    has_data: true,
  }
}

function emptyRanks(): RankLookups {
  return {
    season: new Map(),
    last15: new Map(),
    poolSizeSeason: 100,
    poolSizeLast15: 100,
  }
}

function l15Gp(...pairs: [number, number][]): Map<number, number> {
  return new Map(pairs)
}

describe('detectLineupHints (grouped)', () => {
  it('merges injured starters into one hint without naming replacements', () => {
    const ranks = emptyRanks()
    const hints = detectLineupHints({
      teamDetail: minimalTeamDetail([p(1, 'Player A', 'PG'), p(2, 'Player B', 'C')]),
      ranks,
      injuryStatusByPlayerName: new Map([
        [normalizePlayerName('Player A'), 'Out'],
        [normalizePlayerName('Player B'), 'Questionable'],
      ]),
    })
    const injured = hints.filter((h) => h.id === 'lineup-injured-starters')
    expect(injured).toHaveLength(1)
    expect(injured[0].players).toHaveLength(2)
    expect(injured[0].body).not.toMatch(/bench|starting|replacement/i)
    expect(injured[0].players![0].injuryStatus).toBe('Out')
  })

  it('adds tonight matchup on injured starters when roster day has a game', () => {
    const ranks = emptyRanks()
    const rosterDay = minimalRosterDay([
      {
        player_id: 1,
        player_name: 'Player A',
        positions: ['PG'],
        pro_team: 'LAL',
        lineup_slot: 'PG',
        opponent: 'GSW',
        status: 'scheduled',
        stats: null,
        added: false,
        dropped: false,
      },
    ])
    const hints = detectLineupHints({
      teamDetail: minimalTeamDetail([p(1, 'Player A', 'PG')]),
      ranks,
      rosterDay,
      injuryStatusByPlayerName: new Map([[normalizePlayerName('Player A'), 'Questionable']]),
    })
    const injured = hints.find((h) => h.id === 'lineup-injured-starters')!
    expect(injured.players![0].notes).toContain('Tonight vs GSW')
  })

  function rosterDayFor(...entries: Parameters<typeof minimalRosterDay>[0]) {
    return minimalRosterDay(entries)
  }

  it('omits consider starting/benching without today roster day', () => {
    const ranks = emptyRanks()
    ranks.last15.set(1, { rank: 50, window: 'last_15' })
    ranks.season.set(2, { rank: 200, window: 'season' })
    const hints = detectLineupHints({
      teamDetail: minimalTeamDetail([p(1, 'Hot Bench', 'BE'), p(2, 'Cold Starter', 'C')]),
      ranks,
    })
    expect(hints.some((h) => h.id === 'lineup-consider-starting')).toBe(false)
    expect(hints.some((h) => h.id === 'lineup-consider-benching')).toBe(false)
  })

  it('splits consider starting and consider benching using today schedule', () => {
    const ranks = emptyRanks()
    ranks.last15.set(1, { rank: 50, window: 'last_15' })
    ranks.season.set(1, { rank: 180, window: 'season' })
    ranks.season.set(2, { rank: 200, window: 'season' })
    ranks.last15.set(2, { rank: 170, window: 'last_15' })
    const hints = detectLineupHints({
      teamDetail: minimalTeamDetail([p(1, 'Hot Bench', 'BE'), p(2, 'Cold Starter', 'C')]),
      ranks,
      last15GpByPlayerId: l15Gp([1, 5], [2, 5]),
      rosterDay: rosterDayFor(
        {
          player_id: 1,
          player_name: 'Hot Bench',
          positions: ['C'],
          pro_team: 'LAL',
          lineup_slot: 'BE',
          opponent: 'SAC',
          status: 'scheduled',
          stats: null,
          added: false,
          dropped: false,
        },
        {
          player_id: 2,
          player_name: 'Cold Starter',
          positions: ['C'],
          pro_team: 'LAL',
          lineup_slot: 'C',
          opponent: 'SAC',
          status: 'scheduled',
          stats: null,
          added: false,
          dropped: false,
        },
      ),
    })
    expect(hints.some((h) => h.id === 'lineup-consider-starting')).toBe(true)
    expect(hints.some((h) => h.id === 'lineup-consider-benching')).toBe(true)
    const start = hints.find((h) => h.id === 'lineup-consider-starting')!
    expect(start.players![0].notes).toContain('Tonight vs SAC')
    expect(start.players![0].notes?.some((n) => n.startsWith('Last 15 rank in top'))).toBe(true)
  })

  it('suggests starting when only season rank is inside top 120', () => {
    const ranks = emptyRanks()
    ranks.season.set(1, { rank: 100, window: 'season' })
    const hints = detectLineupHints({
      teamDetail: minimalTeamDetail([p(1, 'Hot Bench', 'BE')]),
      ranks,
      last15GpByPlayerId: l15Gp([1, 0]),
      rosterDay: rosterDayFor({
        player_id: 1,
        player_name: 'Hot Bench',
        positions: ['C'],
        pro_team: 'LAL',
        lineup_slot: 'BE',
        opponent: 'SAC',
        status: 'scheduled',
        stats: null,
        added: false,
        dropped: false,
      }),
    })
    const start = hints.find((h) => h.id === 'lineup-consider-starting')!
    expect(start.players![0].notes?.some((n) => n.startsWith('Season rank in top 120'))).toBe(true)
  })

  it('omits L15-only consider starting when last-15 GP is below 2', () => {
    const ranks = emptyRanks()
    ranks.last15.set(1, { rank: 50, window: 'last_15' })
    ranks.season.set(1, { rank: 200, window: 'season' })
    const hints = detectLineupHints({
      teamDetail: minimalTeamDetail([p(1, 'Hot Bench', 'BE')]),
      ranks,
      last15GpByPlayerId: l15Gp([1, 1]),
      rosterDay: rosterDayFor({
        player_id: 1,
        player_name: 'Hot Bench',
        positions: ['C'],
        pro_team: 'LAL',
        lineup_slot: 'BE',
        opponent: 'SAC',
        status: 'scheduled',
        stats: null,
        added: false,
        dropped: false,
      }),
    })
    expect(hints.some((h) => h.id === 'lineup-consider-starting')).toBe(false)
  })

  it('allows L15-only consider starting with at least 2 GP in the window', () => {
    const ranks = emptyRanks()
    ranks.last15.set(1, { rank: 50, window: 'last_15' })
    ranks.season.set(1, { rank: 200, window: 'season' })
    const hints = detectLineupHints({
      teamDetail: minimalTeamDetail([p(1, 'Hot Bench', 'BE')]),
      ranks,
      last15GpByPlayerId: l15Gp([1, 2]),
      rosterDay: rosterDayFor({
        player_id: 1,
        player_name: 'Hot Bench',
        positions: ['C'],
        pro_team: 'LAL',
        lineup_slot: 'BE',
        opponent: 'SAC',
        status: 'scheduled',
        stats: null,
        added: false,
        dropped: false,
      }),
    })
    expect(hints.some((h) => h.id === 'lineup-consider-starting')).toBe(true)
  })

  it('does not suggest benching when season and L15 are both inside cutoffs', () => {
    const ranks = emptyRanks()
    ranks.season.set(2, { rank: 50, window: 'season' })
    ranks.last15.set(2, { rank: 100, window: 'last_15' })
    const hints = detectLineupHints({
      teamDetail: minimalTeamDetail([p(2, 'Still Good L15', 'C')]),
      ranks,
      rosterDay: rosterDayFor({
        player_id: 2,
        player_name: 'Still Good L15',
        positions: ['C'],
        pro_team: 'LAL',
        lineup_slot: 'C',
        opponent: 'SAC',
        status: 'scheduled',
        stats: null,
        added: false,
        dropped: false,
      }),
    })
    expect(hints.some((h) => h.id === 'lineup-consider-benching')).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import type { AdpPlayer, LastYearStats } from '../../types/api'
import type { MockPick, MockSession, MockSessionPlayer } from '../mockDraft'
import {
  aggregateTeamCats,
  buildProjectedStandings,
  clampCalcBy,
  formatCalcByLabel,
  normalizeColumn,
  rotoPoints,
} from '../mockProjectedStandings'

const stats = (overrides: Partial<LastYearStats> = {}): LastYearStats => ({
  gp: 70,
  fg_pct: 0.5,
  ft_pct: 0.8,
  fgm: 8,
  fga: 16,
  ftm: 4,
  fta: 5,
  ppg: 20,
  rpg: 5,
  apg: 4,
  spg: 1,
  bpg: 0.5,
  three_pm: 2,
  ...overrides,
})

const EMPTY_SITE = { adp: null, rank: null, ranking: null }

const player = (id: string, line?: LastYearStats | null, projection?: LastYearStats | null): AdpPlayer => ({
  id,
  espn_id: Number(id) || null,
  name: id,
  team: null,
  team_abbr: 'DEN',
  photo_url: null,
  positions: ['PG'],
  espn: EMPTY_SITE,
  fantrax: EMPTY_SITE,
  sleeper: EMPTY_SITE,
  yahoo: EMPTY_SITE,
  blend: 1,
  blend_rank: 1,
  spread: null,
  ranking_blend: null,
  ranking_blend_rank: null,
  ranking_spread: null,
  last_year: line === undefined ? stats() : line,
  projection: projection === undefined ? null : projection,
})

const sessionPlayer = (id: string): MockSessionPlayer => ({
  id,
  espn_id: Number(id) || null,
  name: id,
  team_abbr: 'DEN',
  positions: ['PG'],
})

function sessionOf(opts: {
  teams?: number
  rounds?: number
  picks: Array<{ team: number; playerId: string }>
}): MockSession {
  const teams = opts.teams ?? 12
  const rounds = opts.rounds ?? 15
  const picks: MockPick[] = opts.picks.map((pk, i) => ({
    pick: i + 1,
    team: pk.team,
    round: 1,
    pickInRound: i + 1,
    playerId: pk.playerId,
  }))
  const players: Record<string, MockSessionPlayer> = {}
  for (const pk of opts.picks) players[pk.playerId] = sessionPlayer(pk.playerId)
  return {
    teams,
    rounds,
    threeRr: true,
    userTeam: 1,
    botDelaySec: 0,
    userClockSec: 60,
    defaultOrder: Object.keys(players),
    userOrder: Object.keys(players),
    players,
    picks,
    rosters: {},
  }
}

describe('aggregateTeamCats', () => {
  it('GP-weights counting stats and attempt-weights shooting', () => {
    const highVolume = stats({ gp: 80, ppg: 10, fgm: 5, fga: 10, ftm: 2, fta: 2, three_pm: 1, rpg: 4, apg: 3, spg: 1, bpg: 1 })
    const lowVolume = stats({ gp: 20, ppg: 20, fgm: 8, fga: 10, ftm: 4, fta: 8, three_pm: 3, rpg: 2, apg: 1, spg: 0, bpg: 0 })
    const { values, playerCount } = aggregateTeamCats([highVolume, lowVolume], 'totals')
    expect(playerCount).toBe(2)
    expect(values.pts).toBe(80 * 10 + 20 * 20)
    expect(values.reb).toBe(80 * 4 + 20 * 2)
    expect(values.three_pm).toBe(80 * 1 + 20 * 3)
    expect(values.fg_pct).toBeCloseTo((5 * 80 + 8 * 20) / (10 * 80 + 10 * 20))
    expect(values.ft_pct).toBeCloseTo((2 * 80 + 4 * 20) / (2 * 80 + 8 * 20))
  })

  it('averages are per-game: season totals divided by mean team GP; FG%/FT% stay weighted', () => {
    const a = stats({ gp: 80, ppg: 10, fgm: 4, fga: 8, three_pm: 1 })
    const b = stats({ gp: 20, ppg: 20, fgm: 8, fga: 16, three_pm: 3 })
    const totals = aggregateTeamCats([a, b], 'totals')
    const avgs = aggregateTeamCats([a, b], 'averages')
    const meanGp = (80 + 20) / 2
    expect(avgs.values.pts).toBeCloseTo((totals.values.pts ?? 0) / 2 / meanGp)
    expect(avgs.values.pts).toBeCloseTo((80 * 10 + 20 * 20) / (80 + 20))
    expect(avgs.values.three_pm).toBeCloseTo((80 * 1 + 20 * 3) / 100)
    expect(avgs.values.fg_pct).toBe(totals.values.fg_pct)
    expect(avgs.values.ft_pct).toBe(totals.values.ft_pct)
  })

  it('skips gp <= 0 lines', () => {
    const out = aggregateTeamCats([stats({ gp: 0, ppg: 40 }), stats({ gp: 70, ppg: 10 })], 'totals')
    expect(out.playerCount).toBe(1)
    expect(out.values.pts).toBe(700)
  })

  it('returns nulls when nobody is eligible', () => {
    expect(aggregateTeamCats([], 'totals').values.pts).toBeNull()
    expect(aggregateTeamCats([stats({ gp: 0 })], 'totals').playerCount).toBe(0)
  })

  it('leaves FG% null when nobody attempted a field goal', () => {
    const out = aggregateTeamCats([stats({ fgm: 0, fga: 0, ftm: 4, fta: 5 })], 'totals')
    expect(out.values.fg_pct).toBeNull()
    expect(out.values.ft_pct).toBeCloseTo(0.8)
  })
})

describe('rotoPoints', () => {
  it('gives 1 to the lowest and league size to the highest', () => {
    expect(rotoPoints([10, 20, 30, 40])).toEqual([1, 2, 3, 4])
  })

  it('splits ties with average ranks', () => {
    expect(rotoPoints([10, 10, 30])).toEqual([1.5, 1.5, 3])
  })

  it('ranks nulls last (1 point when they are the unique worst)', () => {
    expect(rotoPoints([null, 10, 20])).toEqual([1, 2, 3])
  })

  it('splits last place when several teams have no value', () => {
    expect(rotoPoints([null, null, 50])).toEqual([1.5, 1.5, 3])
  })

  it('uses a 1..12 scale for twelve distinct values', () => {
    const values = Array.from({ length: 12 }, (_, i) => i + 1)
    expect(rotoPoints(values)).toEqual(values)
  })
})

describe('normalizeColumn', () => {
  it('maps min to 0 and max to 1', () => {
    expect(normalizeColumn([10, 20, 30])).toEqual([0, 0.5, 1])
  })

  it('treats null as the worst color stop', () => {
    expect(normalizeColumn([null, 10])).toEqual([0, 1])
  })
})

describe('buildProjectedStandings', () => {
  it('skips players with no stats (all dashes)', () => {
    const session = sessionOf({
      teams: 2,
      rounds: 10,
      picks: [
        { team: 1, playerId: 'star' },
        { team: 2, playerId: 'ghost' },
      ],
    })
    const details = new Map<string, AdpPlayer>([
      ['star', player('star', stats({ ppg: 25, gp: 80 }))],
      ['ghost', player('ghost', null)],
    ])
    const rows = buildProjectedStandings({
      session,
      detailsById: details,
      statsFrom: 'actual',
      mode: 'totals',
      topN: 10,
    })
    const you = rows.find((r) => r.team === 1)
    const other = rows.find((r) => r.team === 2)
    expect(you?.playerCount).toBe(1)
    expect(you?.values.pts).toBe(2000)
    expect(other?.playerCount).toBe(0)
    expect(other?.values.pts).toBeNull()
    expect(other?.points.pts).toBe(1)
    expect(you?.points.pts).toBe(2)
  })

  it('uses projection lines when asked', () => {
    const session = sessionOf({
      teams: 2,
      rounds: 10,
      picks: [{ team: 1, playerId: 'a' }],
    })
    const details = new Map<string, AdpPlayer>([
      ['a', player('a', stats({ ppg: 10, gp: 70 }), stats({ ppg: 30, gp: 70 }))],
    ])
    const lastYear = buildProjectedStandings({
      session,
      detailsById: details,
      statsFrom: 'actual',
      mode: 'totals',
      topN: 10,
    })
    const proj = buildProjectedStandings({
      session,
      detailsById: details,
      statsFrom: 'projection',
      mode: 'totals',
      topN: 10,
    })
    expect(lastYear.find((r) => r.team === 1)?.values.pts).toBe(700)
    expect(proj.find((r) => r.team === 1)?.values.pts).toBe(2100)
  })

  it('cuts off after the first N picks on a team', () => {
    const picks = Array.from({ length: 10 }, (_, i) => ({
      team: 1 as const,
      playerId: `p${i + 1}`,
    }))
    const session = sessionOf({ teams: 2, rounds: 10, picks })
    session.picks = picks.map((pk, i) => ({
      pick: i + 1,
      team: 1,
      round: i + 1,
      pickInRound: 1,
      playerId: pk.playerId,
    }))
    const details = new Map<string, AdpPlayer>()
    for (let i = 1; i <= 10; i++) {
      details.set(`p${i}`, player(`p${i}`, stats({ ppg: 1, gp: 10 })))
    }
    const rows = buildProjectedStandings({
      session,
      detailsById: details,
      statsFrom: 'actual',
      mode: 'totals',
      topN: 8,
    })
    expect(rows.find((r) => r.team === 1)?.playerCount).toBe(8)
    expect(rows.find((r) => r.team === 1)?.values.pts).toBe(8 * 10)
  })

  it('sorts by total roto points then team number', () => {
    const session = sessionOf({
      teams: 3,
      rounds: 10,
      picks: [
        { team: 2, playerId: 'best' },
        { team: 1, playerId: 'mid' },
      ],
    })
    const details = new Map<string, AdpPlayer>([
      ['best', player('best', stats({ ppg: 30, rpg: 12, apg: 10, spg: 2, bpg: 2, three_pm: 4, fgm: 12, fga: 20, ftm: 6, fta: 6, gp: 80 }))],
      ['mid', player('mid', stats({ ppg: 10, rpg: 4, apg: 3, spg: 0.5, bpg: 0.2, three_pm: 1, fgm: 4, fga: 12, ftm: 2, fta: 4, gp: 60 }))],
    ])
    const rows = buildProjectedStandings({
      session,
      detailsById: details,
      statsFrom: 'actual',
      mode: 'totals',
      topN: 10,
    })
    expect(rows[0].team).toBe(2)
    expect(rows[0].totalPoints).toBeGreaterThan(rows[1].totalPoints)
    expect(rows.map((r) => r.team)).toEqual([2, 1, 3])
  })
})

describe('clampCalcBy', () => {
  it('stays between 1 and rounds', () => {
    expect(clampCalcBy(1, 15)).toBe(1)
    expect(clampCalcBy(15, 15)).toBe(15)
    expect(clampCalcBy(0, 12)).toBe(1)
    expect(clampCalcBy(20, 12)).toBe(12)
  })
})

describe('formatCalcByLabel', () => {
  it('labels the ends and the steps in between', () => {
    expect(formatCalcByLabel(15, 15)).toBe('All players')
    expect(formatCalcByLabel(1, 15)).toBe('Top player')
    expect(formatCalcByLabel(8, 15)).toBe('Top 8 players')
  })
})

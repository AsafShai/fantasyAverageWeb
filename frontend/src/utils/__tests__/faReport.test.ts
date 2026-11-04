import { describe, it, expect } from 'vitest'
import {
  buildDraftedNameKeys,
  buildLastFaPickupByPlayerId,
  buildFaReportRows,
  FA_REPORT_MAX_SEASON_RANK,
  formatFaPickupDate,
} from '../faReport'
import type { DraftPick, Player } from '../../types/api'
import type { ActivityMove, ActivityTeam, LeagueActivity } from '../../types/activity'

function makePlayer(overrides: Partial<{ name: string; gp: number; pts: number; player_id: number }>): Player {
  return {
    player_id: overrides.player_id ?? 100,
    player_name: overrides.name ?? 'Player',
    pro_team: 'LAL',
    positions: ['PG'],
    stats: {
      pts: overrides.pts ?? 20,
      reb: 5,
      ast: 5,
      stl: 1,
      blk: 0.5,
      three_pm: 2,
      fg_percentage: 0.47,
      ft_percentage: 0.85,
      fgm: 8,
      fga: 17,
      ftm: 4,
      fta: 5,
      minutes: 30,
      gp: overrides.gp ?? 50,
    },
    team_id: 0,
    status: 'FREEAGENT',
    has_data: true,
  }
}

function makePick(name: string): DraftPick {
  return { pick: 1, round: 1, team_id: 1, team_name: 'Team A', player_name: name }
}

describe('buildDraftedNameKeys', () => {
  it('normalizes drafted names', () => {
    const keys = buildDraftedNameKeys([makePick('  LeBron James  ')])
    expect(keys.has('lebron james')).toBe(true)
  })
})

describe('buildLastFaPickupByPlayerId', () => {
  const teams: ActivityTeam[] = [{ team_id: 2, name: 'B Team', abbrev: 'BT' }]

  it('keeps the latest add per player', () => {
    const moves: ActivityMove[] = [
      {
        id: '1',
        kind: 'add',
        at: '2025-11-01T12:00:00Z',
        team_id: 2,
        other_team_id: null,
        trade_id: null,
        added: [{ player_id: 42, name: 'Free Guy' }],
        dropped: [],
      },
      {
        id: '2',
        kind: 'waiver',
        at: '2025-11-10T12:00:00Z',
        team_id: 2,
        other_team_id: null,
        trade_id: null,
        added: [{ player_id: 42, name: 'Free Guy' }],
        dropped: [],
      },
    ]
    const map = buildLastFaPickupByPlayerId(moves, teams)
    expect(map.get(42)?.at).toBe('2025-11-10T12:00:00Z')
    expect(map.get(42)?.kind).toBe('waiver')
    expect(map.get(42)?.team_name).toBe('B Team')
  })

  it('ignores drops and trades without add', () => {
    const moves: ActivityMove[] = [
      {
        id: '1',
        kind: 'drop',
        at: '2025-11-01T12:00:00Z',
        team_id: 2,
        other_team_id: null,
        trade_id: null,
        added: [],
        dropped: [{ player_id: 99, name: 'X' }],
      },
    ]
    expect(buildLastFaPickupByPlayerId(moves, teams).size).toBe(0)
  })
})

describe('buildFaReportRows', () => {
  it('excludes drafted players and includes undrafted with FA pickup', () => {
    const drafted = makePlayer({ name: 'Drafted Star', player_id: 1, gp: 60 })
    const free = makePlayer({ name: 'Still Free', player_id: 2, gp: 40, pts: 25 })
    const activity: LeagueActivity = {
      season_id: 2027,
      season_over: false,
      latest_date: '2025-10-05',
      categories: ['PTS'],
      teams: [{ team_id: 3, name: 'C Team', abbrev: 'CT' }],
      moves: [
        {
          id: 'a',
          kind: 'add',
          at: '2025-10-05T00:00:00Z',
          team_id: 3,
          other_team_id: null,
          trade_id: null,
          added: [{ player_id: 2, name: 'Still Free' }],
          dropped: [],
        },
      ],
      trades: [],
      released: [],
      last_updated: '2025-10-05T00:00:00Z',
    }
    const rows = buildFaReportRows(
      [makePick('Drafted Star')],
      [drafted, free, ...Array.from({ length: 20 }, (_, i) => makePlayer({ name: `F ${i}`, player_id: 100 + i, gp: 55 }))],
      activity,
      'per_game',
    )
    const names = rows.map(r => r.player_name)
    expect(names).not.toContain('Drafted Star')
    const row = rows.find(r => r.player_name === 'Still Free')
    expect(row?.lastFaPickup?.team_name).toBe('C Team')
    expect(row?.valueRank).not.toBeNull()
    expect(row!.valueRank!).toBeLessThanOrEqual(FA_REPORT_MAX_SEASON_RANK)
  })

  it('excludes undrafted players outside the top season rank cutoff', () => {
    const low = makePlayer({ name: 'Bench Fodder', player_id: 50, gp: 70, pts: 1 })
    const fillers = Array.from({ length: FA_REPORT_MAX_SEASON_RANK + 5 }, (_, i) =>
      makePlayer({ name: `Rank Filler ${i}`, player_id: 200 + i, gp: 70, pts: 15 + (i % 3) }),
    )
    const rows = buildFaReportRows([], [low, ...fillers], undefined, 'per_game')
    expect(rows.every(r => r.valueRank !== null && r.valueRank <= FA_REPORT_MAX_SEASON_RANK)).toBe(true)
    expect(rows.find(r => r.player_name === 'Bench Fodder')).toBeUndefined()
  })

  it('excludes undrafted players under min GP', () => {
    const low = makePlayer({ name: 'Short Sample', player_id: 8, gp: 3, pts: 30 })
    const rows = buildFaReportRows([], [low], undefined, 'per_game')
    expect(rows).toHaveLength(0)
  })

  it('works without activity', () => {
    const free = makePlayer({ name: 'Never Added', player_id: 5, gp: 30 })
    const rows = buildFaReportRows([], [free], undefined, 'per_game')
    expect(rows).toHaveLength(1)
    expect(rows[0].lastFaPickup).toBeNull()
  })
})

describe('formatFaPickupDate', () => {
  it('formats ISO dates', () => {
    expect(formatFaPickupDate('2025-11-03T15:00:00Z')).toMatch(/2025/)
  })
})

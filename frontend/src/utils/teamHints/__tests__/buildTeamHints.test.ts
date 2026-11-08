import { describe, expect, it } from 'vitest'
import type { Player, RosterDay, TeamDetail } from '../../../types/api'
import { buildTeamHints } from '../buildTeamHints'
import type { RankLookups } from '../types'

function player(id: number, name: string, slot: string, positions: string[], gp = 20): Player {
  return {
    player_id: id,
    player_name: name,
    pro_team: 'LAL',
    positions,
    lineup_slot: slot,
    stats: {
      gp,
      minutes: gp * 24,
      pts: 15,
      reb: 5,
      ast: 3,
      stl: 1,
      blk: 1,
      fgm: 5,
      fga: 10,
      ftm: 2,
      fta: 3,
      fg_percentage: 0.5,
      ft_percentage: 0.67,
      three_pm: 1,
    },
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

describe('buildTeamHints', () => {
  it('suggests starting a much hotter bench player (L15)', () => {
    const hot = player(1, 'Hot Bench', 'BE', ['C'])
    const cold = player(2, 'Cold Starter', 'C', ['C'])
    const team: TeamDetail = {
      team: { team_id: 1, team_name: 'Mine' },
      espn_url: '',
      players: [hot, cold],
      shot_chart: { fgm: 0, fga: 0, fg_percentage: 0, ftm: 0, fta: 0, ft_percentage: 0, gp: 0 },
      raw_averages: { gp: 1, fg_percentage: 0, ft_percentage: 0, fgm: 0, fga: 0, ftm: 0, fta: 0, three_pm: 0, reb: 0, ast: 0, stl: 0, blk: 0, pts: 0, team: { team_id: 1, team_name: 'Mine' } },
      ranking_stats: { team: { team_id: 1, team_name: 'Mine' }, rank: 1, total_points: 100, stats: {} },
      category_ranks: {},
      slot_usage: {},
    }
    const ranks = emptyRanks()
    ranks.last15.set(1, { rank: 40, window: 'last_15' })
    ranks.last15.set(2, { rank: 150, window: 'last_15' })

    const rosterDay: RosterDay = {
      team_id: 1,
      date: '2026-03-01',
      has_games: true,
      is_today: true,
      lock_at: null,
      players: [
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
          opponent: 'DEN',
          status: 'scheduled',
          stats: null,
          added: false,
          dropped: false,
        },
      ],
      moves: [],
    }

    const { all } = buildTeamHints({ teamDetail: team, ranks, rosterDay })
    expect(all.some((h) => h.id === 'lineup-consider-starting' && h.players?.some((pl) => pl.name === 'Hot Bench'))).toBe(true)
  })

  it('flags wasted IR slot when healthy and not on injury report', () => {
    const healthy = player(3, 'Healthy IR', 'IR', ['PG'])
    healthy.injured = false
    const team: TeamDetail = {
      team: { team_id: 1, team_name: 'Mine' },
      espn_url: '',
      players: [healthy],
      shot_chart: { fgm: 0, fga: 0, fg_percentage: 0, ftm: 0, fta: 0, ft_percentage: 0, gp: 0 },
      raw_averages: { gp: 1, fg_percentage: 0, ft_percentage: 0, fgm: 0, fga: 0, ftm: 0, fta: 0, three_pm: 0, reb: 0, ast: 0, stl: 0, blk: 0, pts: 0, team: { team_id: 1, team_name: 'Mine' } },
      ranking_stats: { team: { team_id: 1, team_name: 'Mine' }, rank: 1, total_points: 100, stats: {} },
      category_ranks: {},
      slot_usage: {},
    }
    const { all } = buildTeamHints({
      teamDetail: team,
      ranks: emptyRanks(),
      injuryStatusByPlayerName: new Map(),
      injuryReportTeamKeys: new Set(['losangeleslakers']),
      nbaTeams: [{ abbreviation: 'LAL', team_name: 'Los Angeles Lakers' }],
    })
    expect(all.some((h) => h.id === 'roster-ir-not-out')).toBe(true)
  })
})

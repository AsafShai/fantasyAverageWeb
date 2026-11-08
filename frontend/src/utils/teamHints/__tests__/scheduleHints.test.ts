import { describe, expect, it } from 'vitest'
import type { Player, RosterDay, TeamDetail } from '../../../types/api'
import { normalizePlayerName } from '../../../utils/playerName'
import { detectScheduleHints } from '../detectors/schedule'
import type { RankLookups } from '../types'

const ranks: RankLookups = {
  season: new Map(),
  last15: new Map(),
  poolSizeSeason: 100,
  poolSizeLast15: 100,
}

function team(players: Player[]): TeamDetail {
  return {
    team: { team_id: 1, team_name: 'Mine' },
    espn_url: '',
    players,
    shot_chart: { fgm: 0, fga: 0, fg_percentage: 0, ftm: 0, fta: 0, ft_percentage: 0, gp: 0 },
    raw_averages: { gp: 1, fg_percentage: 0, ft_percentage: 0, fgm: 0, fga: 0, ftm: 0, fta: 0, three_pm: 0, reb: 0, ast: 0, stl: 0, blk: 0, pts: 0, team: { team_id: 1, team_name: 'Mine' } },
    ranking_stats: { team: { team_id: 1, team_name: 'Mine' }, rank: 1, total_points: 100, stats: {} },
    category_ranks: {},
    slot_usage: {},
  }
}

describe('detectScheduleHints', () => {
  it('lists bench players who play tonight with injury status, without naming starters to bench', () => {
    const rosterDay: RosterDay = {
      team_id: 1,
      date: '2026-03-01',
      has_games: true,
      is_today: true,
      lock_at: null,
      players: [
        {
          player_id: 1,
          player_name: 'Idle Starter',
          positions: ['C'],
          pro_team: 'LAL',
          lineup_slot: 'C',
          opponent: null,
          status: 'no_game',
          stats: null,
          added: false,
          dropped: false,
        },
        {
          player_id: 2,
          player_name: 'Bench Plays',
          positions: ['C'],
          pro_team: 'SAC',
          lineup_slot: 'BE',
          opponent: 'LAL',
          status: 'scheduled',
          stats: null,
          added: false,
          dropped: false,
        },
        {
          player_id: 3,
          player_name: 'Bench GTD',
          positions: ['PG'],
          pro_team: 'BOS',
          lineup_slot: 'BE',
          opponent: 'NYK',
          status: 'scheduled',
          stats: null,
          added: false,
          dropped: false,
        },
      ],
      moves: [],
    }
    const hints = detectScheduleHints({
      teamDetail: team([]),
      ranks,
      rosterDay,
      injuryStatusByPlayerName: new Map([[normalizePlayerName('Bench GTD'), 'Questionable']]),
    })
    expect(hints).toHaveLength(1)
    expect(hints[0].title).toBe('Games tonight')
    expect(hints[0].body).not.toMatch(/starter|benching|doesn't/i)
    expect(hints[0].players).toHaveLength(2)
    expect(hints[0].players!.map((p) => p.name).sort()).toEqual(['Bench GTD', 'Bench Plays'])
    const gtd = hints[0].players!.find((p) => p.name === 'Bench GTD')
    expect(gtd?.injuryStatus).toBe('Questionable')
  })

  it('omits Out players on the injury report', () => {
    const rosterDay: RosterDay = {
      team_id: 1,
      date: '2026-03-01',
      has_games: true,
      is_today: true,
      lock_at: null,
      players: [
        {
          player_id: 2,
          player_name: 'Out Bench',
          positions: ['C'],
          pro_team: 'SAC',
          lineup_slot: 'BE',
          opponent: 'LAL',
          status: 'scheduled',
          stats: null,
          added: false,
          dropped: false,
        },
      ],
      moves: [],
    }
    const hints = detectScheduleHints({
      teamDetail: team([]),
      ranks,
      rosterDay,
      injuryStatusByPlayerName: new Map([[normalizePlayerName('Out Bench'), 'Out']]),
    })
    expect(hints).toHaveLength(0)
  })
})

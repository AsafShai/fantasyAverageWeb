import type { Player, RosterDay, TeamDetail } from '../../../types/api'

const MINE = { team_id: 1, team_name: 'Mine' }

export function minimalTeamDetail(players: Player[] = []): TeamDetail {
  return {
    team: MINE,
    espn_url: '',
    players,
    shot_chart: { team: MINE, fgm: 0, fga: 0, fg_percentage: 0, ftm: 0, fta: 0, ft_percentage: 0, gp: 0 },
    raw_averages: {
      team: MINE,
      fg_percentage: 0,
      ft_percentage: 0,
      three_pm: 0,
      ast: 0,
      reb: 0,
      stl: 0,
      blk: 0,
      pts: 0,
      gp: 1,
    },
    ranking_stats: {
      team: MINE,
      fg_percentage: 0,
      ft_percentage: 0,
      three_pm: 0,
      ast: 0,
      reb: 0,
      stl: 0,
      blk: 0,
      pts: 0,
      gp: 1,
      total_points: 100,
      rank: 1,
      stats: {},
    },
    category_ranks: {},
    slot_usage: {},
  }
}

export function minimalRosterDay(players: RosterDay['players'], partial?: Partial<RosterDay>): RosterDay {
  return {
    team_id: 1,
    date: '2026-03-01',
    scoring_period_id: 1,
    is_today: true,
    has_games: true,
    lock_at: null,
    first_date: '2026-03-01',
    last_date: '2026-04-15',
    players,
    moves: [],
    ...partial,
  }
}

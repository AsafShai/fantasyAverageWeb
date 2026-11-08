import type { RosterDayPlayer } from '../../types/api'
import type { RosterPlayer } from './types'

const EMPTY_GP_STATS: RosterPlayer['stats'] = {
  gp: 0,
  minutes: 0,
  pts: 0,
  reb: 0,
  ast: 0,
  stl: 0,
  blk: 0,
  fgm: 0,
  fga: 0,
  ftm: 0,
  fta: 0,
  fg_percentage: 0,
  ft_percentage: 0,
  three_pm: 0,
}

/** Roster-day rows omit fantasy `team_id`; map for rank / hint player lines. */
export function rosterPlayerFromDayPlayer(p: RosterDayPlayer, teamId: number): RosterPlayer {
  return {
    player_id: p.player_id,
    player_name: p.player_name,
    pro_team: p.pro_team,
    positions: p.positions,
    lineup_slot: p.lineup_slot,
    team_id: teamId,
    status: 'ONTEAM',
    has_data: true,
    stats: EMPTY_GP_STATS,
  }
}

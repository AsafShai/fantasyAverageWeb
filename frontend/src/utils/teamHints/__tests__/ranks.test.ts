import { describe, expect, it } from 'vitest'
import type { Player } from '../../../types/api'
import { buildRankLookups, rankForPlayer } from '../ranks'

function player(id: number, gp: number): Player {
  return {
    player_id: id,
    player_name: `P${id}`,
    pro_team: 'LAL',
    positions: ['PG'],
    stats: {
      gp,
      minutes: gp * 20,
      pts: 10,
      reb: 5,
      ast: 3,
      stl: 1,
      blk: 0,
      fgm: 4,
      fga: 8,
      ftm: 2,
      fta: 2,
      fg_percentage: 0.5,
      ft_percentage: 1,
      three_pm: 1,
    },
    team_id: 1,
    status: 'ONTEAM',
    has_data: true,
  }
}

describe('buildRankLookups window min GP', () => {
  it('ranks last_15 players with fewer than 10 games in the window', () => {
    const season = [player(1, 20), player(2, 20)]
    const last15 = [player(1, 5), player(2, 4)]
    const lookups = buildRankLookups(season, last15)
    const roster = { player_id: 1, player_name: 'P1', lineup_slot: 'BE' } as const
    expect(rankForPlayer(lookups, roster, 'last_15')).not.toBeNull()
    expect(rankForPlayer(lookups, roster, 'season')).not.toBeNull()
  })
})

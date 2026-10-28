import { describe, expect, it } from 'vitest'
import type { Player, TeamDepthChart } from '../../../types/api'
import type { BoxScoreGame } from '../../../types/boxScore'
import { mineCount, rosterSide } from '../pregameRoster'

const stats = {
  gp: 0, minutes: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, three_pm: 0,
  fg_percentage: 0, ft_percentage: 0, fgm: 0, fga: 0, ftm: 0, fta: 0,
}

function player(id: number, name: string, teamId = 8, positions = ['SF']): Player {
  return {
    player_name: name, pro_team: 'LAL', positions, team_id: teamId, status: 'ONTEAM',
    player_id: id, fantasy_team_name: "Dor's Injured Team", stats,
  }
}

function chart(players: TeamDepthChart['positions'][number]['players']): TeamDepthChart {
  return {
    team_id: '13', team_name: 'Lakers', team_abbreviation: 'LAL', team_logo: '', record: '',
    positions: [{ abbreviation: 'SF', display_name: 'SF', players }],
  }
}

const game = {
  status: 'scheduled',
  away: { abbreviation: 'LAL' },
  home: { abbreviation: 'UTAH' },
} as BoxScoreGame

describe('rosterSide', () => {
  it('drops players who are out and keeps a lesser injury next to the name', () => {
    const rows = rosterSide(
      chart([
        { id: '1', display_name: 'Questionable Guy', short_name: 'Q', injury: { status: 'Questionable' } },
        { id: '2', display_name: 'Out Guy', short_name: 'O', injury: { status: 'Out' } },
        { id: '3', display_name: 'Healthy Guy', short_name: 'H', injury: null },
        { id: '4', display_name: 'Cleared Guy', short_name: 'C', injury: { status: 'Available' } },
      ]),
      [player(1, 'Questionable Guy', 8, ['PG', 'SG']), player(2, 'Out Guy'), player(3, 'Healthy Guy'), player(4, 'Cleared Guy')],
      new Map([[8, 'DOR']]),
      new Map(),
    )
    expect(rows.map(row => [row.name, row.position, row.injury, row.rostered])).toEqual([
      ['Cleared Guy', 'SF', null, true],
      ['Healthy Guy', 'SF', null, true],
      ['Questionable Guy', 'PG/SG', 'Questionable', true],
    ])
  })

  it('keeps free agents as FA and drops players who are out', () => {
    const rows = rosterSide(
      chart([
        { id: '1', display_name: 'Rostered', short_name: 'R', injury: null },
        { id: '2', display_name: 'Free Agent', short_name: 'F', injury: null },
        { id: '3', display_name: 'Unknown', short_name: 'U', injury: null },
        { id: '4', display_name: 'Sitting Out', short_name: 'S', injury: { status: 'Out' } },
      ]),
      [player(1, 'Rostered'), { ...player(2, 'Free Agent'), team_id: 0, status: 'FREEAGENT', fantasy_team_name: null }],
      new Map([[8, 'DOR']]),
      new Map(),
    )
    expect(rows.map(row => [row.name, row.fantasyTeam, row.rostered, row.position])).toEqual([
      ['Rostered', 'DOR', true, 'SF'],
      ['Free Agent', null, false, 'SF'],
      ['Unknown', null, false, 'SF'],
    ])
  })
})

describe('mineCount', () => {
  const roster = [
    { player_id: 1, pro_team: 'LAL' },
    { player_id: 2, pro_team: 'LAL' },
    { player_id: 9, pro_team: 'BOS' },
  ]

  it('leaves an out player off a game that has not tipped', () => {
    expect(mineCount(game, roster, new Set(['2']))).toBe(1)
  })

  it('still counts an out player once the game has started', () => {
    expect(mineCount({ ...game, status: 'live' }, roster, new Set(['2']))).toBe(2)
  })
})

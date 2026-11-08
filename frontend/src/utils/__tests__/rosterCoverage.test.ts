import { describe, expect, it } from 'vitest'
import { coverageBarPlayingSplit, rosterDayCoverage } from '../rosterCoverage'
import { opponentsByTeamDate } from '../slateWindow'
import type { Player, ScheduleGame, ScheduleResponse } from '../../types/api'

function game(partial: Pick<ScheduleGame, 'date' | 'opponent_abbreviation' | 'is_home'>): ScheduleGame {
  return {
    game_id: `${partial.date}-x`,
    date: partial.date,
    opponent_id: 1,
    opponent: partial.opponent_abbreviation,
    opponent_abbreviation: partial.opponent_abbreviation,
    is_home: partial.is_home,
    rest_days: null,
    slate_size: 8,
    high_volume: false,
  }
}

const schedule: ScheduleResponse = {
  season: '2026-27',
  high_volume_threshold: 10,
  calendar_days: [],
  published_games_min: 1,
  published_games_max: 1,
  teams: [
    {
      team_id: 1,
      abbreviation: 'LAL',
      team_name: 'Lakers',
      games: [
        game({ date: '2026-10-18', opponent_abbreviation: 'GSW', is_home: true }),
        game({ date: '2026-10-19', opponent_abbreviation: 'DEN', is_home: false }),
      ],
      monthly_games: {},
      total_games: 2,
      b2b_count: 1,
      high_volume_games: 0,
      avg_rest_days: null,
    },
    {
      team_id: 2,
      abbreviation: 'BOS',
      team_name: 'Celtics',
      games: [game({ date: '2026-10-18', opponent_abbreviation: 'NYK', is_home: true })],
      monthly_games: {},
      total_games: 1,
      b2b_count: 0,
      high_volume_games: 0,
      avg_rest_days: null,
    },
  ],
}

const roster: Player[] = [
  { player_id: 1, player_name: 'A', pro_team: 'LAL' } as Player,
  { player_id: 2, player_name: 'B', pro_team: 'BOS' } as Player,
  { player_id: 3, player_name: 'C', pro_team: 'LAL' } as Player,
]

describe('rosterDayCoverage', () => {
  const opponents = opponentsByTeamDate(schedule)
  const playing = new Set(['LAL', 'BOS'])

  it('counts playing and b2b rostered players', () => {
    expect(rosterDayCoverage(roster, playing, '2026-10-18', opponents)).toEqual({ count: 3, b2bCount: 2 })
    expect(rosterDayCoverage(roster, new Set(['LAL']), '2026-10-19', opponents)).toEqual({ count: 2, b2bCount: 2 })
  })
})

describe('coverageBarPlayingSplit', () => {
  it('splits the playing fill with b2b at the bottom band', () => {
    expect(coverageBarPlayingSplit(10, 5, 2)).toEqual({
      totalPct: 50,
      b2bInsidePct: 40,
      nonB2bInsidePct: 60,
    })
  })
})

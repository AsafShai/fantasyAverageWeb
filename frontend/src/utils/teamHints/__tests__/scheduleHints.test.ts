import { describe, expect, it } from 'vitest'
import { normalizePlayerName } from '../../../utils/playerName'
import { detectScheduleHints } from '../detectors/schedule'
import type { RankLookups } from '../types'
import { minimalRosterDay, minimalTeamDetail } from './fixtures'

const ranks: RankLookups = {
  season: new Map(),
  last15: new Map(),
  poolSizeSeason: 100,
  poolSizeLast15: 100,
}

describe('detectScheduleHints', () => {
  it('lists bench players who play tonight with injury status, without naming starters to bench', () => {
    const rosterDay = minimalRosterDay([
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
    ])
    const hints = detectScheduleHints({
      teamDetail: minimalTeamDetail([]),
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
    const rosterDay = minimalRosterDay([
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
    ])
    const hints = detectScheduleHints({
      teamDetail: minimalTeamDetail([]),
      ranks,
      rosterDay,
      injuryStatusByPlayerName: new Map([[normalizePlayerName('Out Bench'), 'Out']]),
    })
    expect(hints).toHaveLength(0)
  })
})

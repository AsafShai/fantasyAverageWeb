import { describe, expect, it } from 'vitest'
import { lineupHintsDayActive, playsTonight } from '../rosterDayNotes'
import { minimalRosterDay } from './fixtures'

const rosterDay = minimalRosterDay([
    {
      player_id: 1,
      player_name: 'A',
      positions: ['PG'],
      pro_team: 'LAL',
      lineup_slot: 'BE',
      opponent: 'BOS',
      status: 'scheduled',
      stats: null,
      added: false,
      dropped: false,
    },
    {
      player_id: 2,
      player_name: 'B',
      positions: ['C'],
      pro_team: 'LAL',
      lineup_slot: 'C',
      opponent: null,
      status: 'no_game',
      stats: null,
      added: false,
      dropped: false,
    },
])

describe('rosterDayNotes', () => {
  it('detects active lineup day and tonight eligibility', () => {
    expect(lineupHintsDayActive(rosterDay)).toBe(true)
    expect(playsTonight(1, rosterDay)).toBe(true)
    expect(playsTonight(2, rosterDay)).toBe(false)
  })
})

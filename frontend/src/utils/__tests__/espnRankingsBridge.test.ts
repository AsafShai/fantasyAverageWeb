import { describe, expect, it } from 'vitest'
import { espnIdOf, toEspnRankingsPayload } from '../espnRankingsBridge'

describe('espn rankings payload', () => {
  it('uses espn_id and falls back to a numeric board id', () => {
    expect(espnIdOf({ id: 'name:x', espn_id: 3975, name: 'A' })).toBe(3975)
    expect(espnIdOf({ id: '1966', espn_id: null, name: 'B' })).toBe(1966)
    expect(espnIdOf({ id: 'name:x', espn_id: null, name: 'C' })).toBeNull()
  })

  it('emits rank order from the current board', () => {
    const payload = toEspnRankingsPayload([
      { id: '2', espn_id: 2, name: 'Bravo', team_abbr: 'BOS' },
      { id: '1', espn_id: 1, name: 'Alpha', team_abbr: 'DEN' },
    ])
    expect(payload.version).toBe(1)
    expect(payload.players.map((p) => p.espnId)).toEqual([2, 1])
    expect(payload.players[0].rank).toBe(1)
  })
})

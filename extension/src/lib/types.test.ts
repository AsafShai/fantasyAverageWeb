import { describe, expect, it } from 'vitest'
import { isRankingsPayload } from './types'

const player = { rank: 1, espnId: 3975, name: 'Stephen Curry', team: 'GSW' }

describe('isRankingsPayload', () => {
  it('accepts a site or CSV payload', () => {
    expect(
      isRankingsPayload({
        version: 1,
        source: 'pre-draft-rankings',
        savedAt: '2026-01-01T00:00:00.000Z',
        players: [player],
      }),
    ).toBe(true)
  })

  it('rejects a players array of junk', () => {
    expect(isRankingsPayload({ version: 1, players: [{ foo: 1 }] })).toBe(false)
    expect(isRankingsPayload({ version: 1, players: 'nope' })).toBe(false)
    expect(
      isRankingsPayload({
        version: 1,
        players: [{ rank: 0, espnId: 1, name: 'A', team: '' }],
      }),
    ).toBe(false)
  })
})

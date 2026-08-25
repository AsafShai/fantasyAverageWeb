import { describe, expect, it } from 'vitest'
import { applyFinishResult } from './reorder'

const unmatched = [{ rank: 300, espnId: 9, name: 'Ghost', team: 'FA' }]

describe('applyFinishResult', () => {
  it('fails when ranks still do not match, even if Save Rankings is enabled', () => {
    const result = applyFinishResult({
      stopped: false,
      placed: 40,
      missing: 2,
      wrong: 8,
      unmatchedCsv: unmatched,
      totalEspn: 300,
      method: 'espn-drags',
      saveOn: true,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/does not match/i)
  })

  it('succeeds only when every matched player is in the expected slot', () => {
    const result = applyFinishResult({
      stopped: false,
      placed: 298,
      missing: 2,
      wrong: 0,
      unmatchedCsv: unmatched,
      totalEspn: 300,
      method: 'espn-drags',
      saveOn: false,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.stopped).toBeUndefined()
      expect(result.matched).toBe(298)
    }
  })

  it('keeps a partial list when the user stops', () => {
    const result = applyFinishResult({
      stopped: true,
      placed: 12,
      missing: 2,
      wrong: 40,
      unmatchedCsv: unmatched,
      totalEspn: 300,
      method: 'espn-drags',
      saveOn: true,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.stopped).toBe(true)
      expect(result.matched).toBe(12)
      expect(result.unmatchedCsv).toEqual(unmatched)
    }
  })
})

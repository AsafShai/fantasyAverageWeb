import { describe, expect, it } from 'vitest'
import { identitiesMatchOrder, nextMisplacedIndex, swapDidNotMove } from './rankMoves'

describe('nextMisplacedIndex', () => {
  it('returns null when already in order', () => {
    expect(nextMisplacedIndex(['a', 'b', 'c'], ['a', 'b', 'c'])).toBeNull()
  })

  it('moves the player who belongs at the first mismatch', () => {
    expect(nextMisplacedIndex(['b', 'a', 'c'], ['a', 'b', 'c'])).toEqual({ from: 1, to: 0 })
  })

  it('skips holes in the target list', () => {
    expect(nextMisplacedIndex(['a', 'c'], [null, 'c'])).toEqual(null)
  })

  it('moves a later matched player into the hole left by a missing csv rank', () => {
    expect(nextMisplacedIndex(['1', '2', '3'], ['1', '3', '2'])).toEqual({ from: 2, to: 1 })
  })
})

describe('identitiesMatchOrder', () => {
  it('requires the visible prefix to match', () => {
    expect(identitiesMatchOrder(['a', 'b'], ['a', 'b', 'c'])).toBe(true)
    expect(identitiesMatchOrder(['b', 'a'], ['a', 'b'])).toBe(false)
  })
})

describe('swapDidNotMove', () => {
  it('is false on the first attempt', () => {
    expect(swapDidNotMove(null, { from: 2, to: 0 }, 'id:1')).toBe(false)
  })

  it('detects a no-op retry of the same swap', () => {
    expect(swapDidNotMove({ from: 2, to: 0, key: 'id:1' }, { from: 2, to: 0 }, 'id:1')).toBe(true)
  })

  it('allows a new player or new slot', () => {
    expect(swapDidNotMove({ from: 2, to: 0, key: 'id:1' }, { from: 3, to: 0 }, 'id:1')).toBe(false)
    expect(swapDidNotMove({ from: 2, to: 0, key: 'id:1' }, { from: 2, to: 0 }, 'id:9')).toBe(false)
  })
})

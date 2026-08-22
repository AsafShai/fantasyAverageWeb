import { describe, expect, it } from 'vitest'
import { moveId, previewMove } from '../draftRankings'

describe('previewMove', () => {
  const order = ['a', 'b', 'c', 'd', 'e', 'f']

  it('places the player in the middle of two above and two below', () => {
    const preview = previewMove(order, 'f', 3)
    expect(preview.order[2]).toBe('f')
    expect(preview.above).toEqual(['a', 'b'])
    expect(preview.below).toEqual(['c', 'd'])
  })

  it('shows fewer neighbors at the top', () => {
    const preview = previewMove(order, 'f', 1)
    expect(preview.order[0]).toBe('f')
    expect(preview.above).toEqual([])
    expect(preview.below).toEqual(['a', 'b'])
  })

  it('shows fewer neighbors at the bottom', () => {
    const preview = previewMove(order, 'a', 6)
    expect(preview.order[5]).toBe('a')
    expect(preview.above).toEqual(['e', 'f'])
    expect(preview.below).toEqual([])
  })

  it('clamps out-of-range ranks', () => {
    expect(previewMove(order, 'c', 0).index).toBe(0)
    expect(previewMove(order, 'c', 99).index).toBe(5)
  })

  it('uses the same order as moveId', () => {
    expect(previewMove(order, 'd', 2).order).toEqual(moveId(order, 'd', 1))
  })
})

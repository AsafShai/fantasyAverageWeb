import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { usePersistedState } from '../usePersistedState'

describe('usePersistedState sync', () => {
  beforeEach(() => localStorage.clear())

  it('keeps components sharing a key in step (one No spoilers setting everywhere)', () => {
    const a = renderHook(() => usePersistedState('boxScores.noSpoilers', false))
    const b = renderHook(() => usePersistedState('boxScores.noSpoilers', false))
    const other = renderHook(() => usePersistedState('boxScores.revealedGames', [] as string[]))
    act(() => a.result.current[1](true))
    expect(b.result.current[0]).toBe(true)
    expect(other.result.current[0]).toEqual([])
    expect(localStorage.getItem('fw:boxScores.noSpoilers')).toBe('true')
    act(() => b.result.current[1](false))
    expect(a.result.current[0]).toBe(false)
  })
})

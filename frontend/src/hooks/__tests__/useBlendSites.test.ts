import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBlendSites } from '../useBlendSites'

// Without providers the Rankings view falls back to ESPN, Sleeper and Yahoo.
const render = () => renderHook(() => useBlendSites('rank'))

describe('useBlendSites weights', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps both sliders movable after a lock leaves only two sites', () => {
    const { result } = render()
    act(() => result.current.weights.setEnabled(true))
    act(() => result.current.weights.toggleLock('espn'))
    expect(result.current.weights.locked).toEqual(['espn'])

    act(() => result.current.toggle('yahoo'))
    expect(result.current.sites).toEqual(['espn', 'sleeper'])
    expect(result.current.weights.locked).toEqual([])

    act(() => result.current.weights.setPercent('sleeper', 70))
    expect(result.current.weights.percents).toEqual({ espn: 30, sleeper: 70 })
  })

  it('re-splits evenly, with nothing locked, when a site is checked again', () => {
    const { result } = render()
    act(() => result.current.weights.setEnabled(true))
    act(() => result.current.weights.toggleLock('espn'))
    act(() => result.current.toggle('yahoo'))
    act(() => result.current.weights.setPercent('espn', 70))
    expect(result.current.weights.percents).toEqual({ espn: 70, sleeper: 30 })

    act(() => result.current.toggle('yahoo'))
    expect(result.current.weights.percents).toEqual({ espn: 34, sleeper: 33, yahoo: 33 })
    expect(result.current.weights.locked).toEqual([])
  })

  it('sends an even split as the plain site list', () => {
    const { result } = render()
    act(() => result.current.weights.setEnabled(true))
    expect(result.current.weights.percents).toEqual({ espn: 34, sleeper: 33, yahoo: 33 })
    expect(result.current.weights.even).toBe(true)
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(result.current.rankSitesParam).toBe('espn,sleeper,yahoo')
  })

  it('waits for a drag to settle before the weights reach the request', () => {
    const { result } = render()
    act(() => result.current.weights.setEnabled(true))
    act(() => result.current.weights.setPercent('espn', 60))
    act(() => result.current.weights.setPercent('espn', 70))
    expect(result.current.rankSitesParam).toBe('espn,sleeper,yahoo')

    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(result.current.rankSitesParam).toBe('espn:70,sleeper:15,yahoo:15')
  })

  it('sends a change of checked sites at once', () => {
    const { result } = render()
    act(() => result.current.toggle('yahoo'))
    expect(result.current.rankSitesParam).toBe('espn,sleeper')
  })
})

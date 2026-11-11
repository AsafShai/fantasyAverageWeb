import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../config/featureFlags', () => ({
  FF_MOBILE_REDESIGN: false,
}))

import { FF_OVERRIDE_KEY, applyFeatureFlagQuery, isMobileRedesignFlagOn, useMobileRedesign } from '../flag'

function setUrl(path: string) {
  window.history.replaceState(null, '', path)
}

describe('mobile redesign flag', () => {
  beforeEach(() => {
    localStorage.clear()
    setUrl('/')
  })

  it('is off by default (build flag off, no override)', () => {
    expect(isMobileRedesignFlagOn(false)).toBe(false)
  })

  it('follows the build flag', () => {
    expect(isMobileRedesignFlagOn(true)).toBe(true)
  })

  it('?ff=mobile stores the override and strips the param, keeping the rest of the URL', () => {
    setUrl('/rankings?view=table&ff=mobile#top')
    expect(applyFeatureFlagQuery()).toBe(true)
    expect(localStorage.getItem(FF_OVERRIDE_KEY)).toBe('1')
    expect(isMobileRedesignFlagOn(false)).toBe(true)
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/rankings?view=table#top')
  })

  it('?ff=off clears the override', () => {
    localStorage.setItem(FF_OVERRIDE_KEY, '1')
    setUrl('/?ff=off')
    expect(applyFeatureFlagQuery()).toBe(true)
    expect(localStorage.getItem(FF_OVERRIDE_KEY)).toBeNull()
    expect(isMobileRedesignFlagOn(false)).toBe(false)
    expect(window.location.search).toBe('')
  })

  it('ignores unknown ?ff values and leaves the URL alone', () => {
    setUrl('/?ff=banana')
    expect(applyFeatureFlagQuery()).toBe(false)
    expect(localStorage.getItem(FF_OVERRIDE_KEY)).toBeNull()
    expect(window.location.search).toBe('?ff=banana')
  })

  it('does nothing without ?ff', () => {
    setUrl('/players?q=luka')
    expect(applyFeatureFlagQuery()).toBe(false)
    expect(window.location.search).toBe('?q=luka')
  })
})

describe('useMobileRedesign', () => {
  const original = window.matchMedia
  let phone = false
  let listeners: (() => void)[] = []

  beforeEach(() => {
    localStorage.clear()
    phone = false
    listeners = []
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 767px)' ? phone : false,
      media: query,
      addEventListener: (_: string, cb: () => void) => listeners.push(cb),
      removeEventListener: (_: string, cb: () => void) => { listeners = listeners.filter((l) => l !== cb) },
    })) as unknown as typeof window.matchMedia
    setUrl('/')
  })
  afterEach(() => {
    window.matchMedia = original
  })

  it('is false on a phone when the flag is off', () => {
    phone = true
    const { result } = renderHook(() => useMobileRedesign())
    expect(result.current).toBe(false)
  })

  it('is false on desktop even with the override on', () => {
    localStorage.setItem(FF_OVERRIDE_KEY, '1')
    const { result } = renderHook(() => useMobileRedesign())
    expect(result.current).toBe(false)
  })

  it('is true on a phone with the override, and reacts to ?ff and resizes', () => {
    phone = true
    const { result } = renderHook(() => useMobileRedesign())
    expect(result.current).toBe(false)

    setUrl('/?ff=mobile')
    act(() => { applyFeatureFlagQuery() })
    expect(result.current).toBe(true)

    phone = false
    act(() => listeners.forEach((l) => l()))
    expect(result.current).toBe(false)
  })
})

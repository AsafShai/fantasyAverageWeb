import { useSyncExternalStore } from 'react'
import { FF_MOBILE_REDESIGN } from '../config/featureFlags'

/**
 * Runtime switch for the mobile redesign.
 *
 * The build flag (VITE_FF_MOBILE_REDESIGN) is the default for everyone. On top
 * of it, one browser can opt in without a deploy:
 *   ?ff=mobile  → remembered in localStorage, redesign on for this browser
 *   ?ff=off     → clears that override (back to the build default)
 * The redesign only ever applies below the md breakpoint (768px): desktop and
 * tablets keep today's layout whatever the flag says.
 */

export const FF_OVERRIDE_KEY = 'fw:ff-mobile-redesign'
export const FF_QUERY_PARAM = 'ff'
/** Phones: below Tailwind's `md` (768px). */
export const MOBILE_QUERY = '(max-width: 767px)'

function readOverride(): boolean {
  try {
    return localStorage.getItem(FF_OVERRIDE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Reads `?ff=` once at startup, stores or clears the override, and removes the
 * param from the address bar so shared links don't carry it. Returns whether
 * the URL was changed.
 */
export function applyFeatureFlagQuery(win: Window = window): boolean {
  const url = new URL(win.location.href)
  const value = url.searchParams.get(FF_QUERY_PARAM)
  if (value === null) return false
  try {
    if (value === 'mobile') localStorage.setItem(FF_OVERRIDE_KEY, '1')
    else if (value === 'off') localStorage.removeItem(FF_OVERRIDE_KEY)
    else return false
  } catch {
    // storage blocked (private mode): nothing to remember
  }
  url.searchParams.delete(FF_QUERY_PARAM)
  win.history.replaceState(win.history.state, '', url.pathname + url.search + url.hash)
  notify()
  return true
}

/** True when the redesign is switched on for this browser (any width). */
export function isMobileRedesignFlagOn(buildDefault: boolean = FF_MOBILE_REDESIGN): boolean {
  return buildDefault || readOverride()
}

// ── subscription: override changes + viewport crossing the breakpoint ──
const listeners = new Set<() => void>()
function notify() {
  listeners.forEach((l) => l())
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(MOBILE_QUERY) : null
  mq?.addEventListener?.('change', cb)
  const onStorage = (e: StorageEvent) => {
    if (e.key === FF_OVERRIDE_KEY) cb()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(cb)
    mq?.removeEventListener?.('change', cb)
    window.removeEventListener('storage', onStorage)
  }
}

function isPhoneWidth(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(MOBILE_QUERY).matches
}

/**
 * The one gate pages and the shell use: redesign flag on AND phone width.
 * Re-renders when the window crosses 768px or the override changes.
 */
export function useMobileRedesign(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isMobileRedesignFlagOn() && isPhoneWidth(),
    () => false,
  )
}

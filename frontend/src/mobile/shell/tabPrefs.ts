import { useCallback, useSyncExternalStore } from 'react'
import { CATALOG, DEFAULT_TAB_IDS, MAX_TABS, MIN_TABS } from './tabs'

/*
 * Which tabs this phone shows, and whether they carry labels. Saved in this
 * browser only (localStorage). A tiny external store rather than component
 * state so the tab bar updates live while Settings edits it.
 */

export interface TabPrefs {
  tabs: string[]
  labels: boolean
}

export const TAB_PREFS_KEY = 'fw:mobile.tabBar'

const KNOWN = new Set(CATALOG.map((t) => t.id))

export const DEFAULT_PREFS: TabPrefs = { tabs: DEFAULT_TAB_IDS, labels: true }

/**
 * Whatever storage holds → a usable list: unknown ids (a page removed or behind
 * a flag that is off) and repeats dropped, at most MAX_TABS kept, and the default
 * bar back when fewer than MIN_TABS survive.
 */
export function sanitizePrefs(raw: unknown): TabPrefs {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_PREFS
  const { tabs, labels } = raw as Partial<TabPrefs>
  const seen = new Set<string>()
  const valid = (Array.isArray(tabs) ? tabs : []).filter((id): id is string => {
    if (typeof id !== 'string' || !KNOWN.has(id) || seen.has(id)) return false
    seen.add(id)
    return true
  })
  if (valid.length < MIN_TABS) return { tabs: DEFAULT_TAB_IDS, labels: labels !== false }
  return { tabs: valid.slice(0, MAX_TABS), labels: labels !== false }
}

function readStored(): TabPrefs {
  try {
    const raw = localStorage.getItem(TAB_PREFS_KEY)
    return raw === null ? DEFAULT_PREFS : sanitizePrefs(JSON.parse(raw))
  } catch {
    return DEFAULT_PREFS
  }
}

let current: TabPrefs | null = null
const listeners = new Set<() => void>()

function getSnapshot(): TabPrefs {
  if (current === null) current = readStored()
  return current
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  // Another tab of the same browser changed it.
  const onStorage = (e: StorageEvent) => {
    if (e.key === TAB_PREFS_KEY) {
      current = null
      cb()
    }
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', onStorage)
  }
}

function setPrefs(next: TabPrefs) {
  current = next
  try {
    localStorage.setItem(TAB_PREFS_KEY, JSON.stringify(next))
  } catch {
    // private mode / quota: the choice lasts until the page is closed
  }
  listeners.forEach((l) => l())
}

/** Forget the in-memory copy, so the next read comes from storage (tests). */
export function resetTabPrefsCache() {
  current = null
}

export function useTabPrefs() {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_PREFS)
  const setTabs = useCallback((tabs: string[]) => setPrefs({ ...getSnapshot(), tabs: tabs.slice(0, MAX_TABS) }), [])
  const setLabels = useCallback((labels: boolean) => setPrefs({ ...getSnapshot(), labels }), [])
  const reset = useCallback(() => setPrefs(DEFAULT_PREFS), [])
  return { ...prefs, setTabs, setLabels, reset }
}

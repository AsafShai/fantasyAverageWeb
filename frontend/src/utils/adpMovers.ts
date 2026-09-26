import type { AdpMetric, AdpMoversQueryArgs } from '../types/api'
import type { AdpSiteKey } from './adp'

export type MoversWindow = 'last_update' | '1d' | '3d' | '7d' | '14d' | '30d' | 'all' | 'custom'
export type MoversDirection = 'both' | 'risers' | 'fallers'

/** `last_update` is rankings-only: ADP moves daily, so "since the last change" is just yesterday. */
export const MOVERS_WINDOWS: { key: MoversWindow; label: string }[] = [
  { key: 'last_update', label: 'Latest update' },
  { key: '1d', label: '1D' },
  { key: '3d', label: '3D' },
  { key: '7d', label: '7D' },
  { key: '14d', label: '14D' },
  { key: '30d', label: '30D' },
  { key: 'all', label: 'All' },
  { key: 'custom', label: 'Custom' },
]

/** 0 = every listed player. */
export const MOVERS_TOP_OPTIONS = [50, 100, 150, 200, 0] as const

const WINDOW_DAYS: Partial<Record<MoversWindow, number>> = { '1d': 1, '3d': 3, '7d': 7, '14d': 14, '30d': 30 }
/** Earlier than any snapshot, so the server clamps to where history starts. */
const ALL_HISTORY_FROM = '2020-01-01'

/** Snapshots are keyed by UTC day, so relative windows are counted in UTC too. */
export function utcDaysAgo(days: number, now: number = Date.now()): string {
  return new Date(now - days * 86_400_000).toISOString().slice(0, 10)
}

export function effectiveWindow(metric: AdpMetric, window: MoversWindow): MoversWindow {
  return window === 'last_update' && metric === 'adp' ? '3d' : window
}

/** Query args for the chosen controls, or null while a custom range has no start yet. */
export function moversQueryArgs({
  metric,
  sites,
  window,
  top,
  customFrom,
  customTo,
  now,
}: {
  metric: AdpMetric
  sites: AdpSiteKey[]
  window: MoversWindow
  top: number
  customFrom?: string
  customTo?: string
  now?: number
}): AdpMoversQueryArgs | null {
  const base = { metric, sites: sites.join(','), top }
  const resolved = effectiveWindow(metric, window)
  if (resolved === 'last_update') return { ...base, mode: 'last_update' }
  if (resolved === 'custom') {
    if (!customFrom) return null
    return { ...base, mode: 'range', from_date: customFrom, ...(customTo ? { to_date: customTo } : {}) }
  }
  if (resolved === 'all') return { ...base, mode: 'range', from_date: ALL_HISTORY_FROM }
  return { ...base, mode: 'range', from_date: utcDaysAgo(WINDOW_DAYS[resolved] ?? 3, now) }
}

export function formatMoveDelta(delta: number | null | undefined): string {
  if (delta == null) return '—'
  const abs = Math.abs(delta)
  const text = Number.isInteger(abs) ? String(abs) : abs.toFixed(1)
  return `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${text}`
}

/** "2026-09-22" -> "Sep 22", read as a calendar day (no timezone shift). */
export function formatMoverDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export function shortDateRange(from: string | null | undefined, to: string | null | undefined): string {
  if (!from || !to) return ''
  return `${formatMoverDate(from)} → ${formatMoverDate(to)}`
}

/** Compact badge text for the board: "▲4.5" / "▼2". */
export function trendBadge(delta: number | null | undefined): { text: string; className: string } | null {
  if (delta == null || delta === 0) return null
  const abs = Math.abs(delta)
  const text = `${delta > 0 ? '▲' : '▼'}${Number.isInteger(abs) ? abs : abs.toFixed(1)}`
  return {
    text,
    className: delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
  }
}

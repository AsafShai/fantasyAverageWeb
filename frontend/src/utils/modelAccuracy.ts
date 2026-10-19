import type { AccuracyWindow, CategoryAccuracy, Player, ProjectionFlag } from '../types/api'

export const WINDOW_LABELS: Record<AccuracyWindow, string> = {
  week: 'This week',
  d30: 'Last 30 days',
  season: 'Season',
}

/** FG%/FT% bands and errors are percentage points; counting stats their own units. */
export function isPctCategory(key: string): boolean {
  return key === 'fg_pct' || key === 'ft_pct'
}

export function formatError(value: number | null, key: string): string {
  if (value == null) return '—'
  return isPctCategory(key) ? value.toFixed(1) : value.toFixed(2)
}

export function formatBand(band: number, key: string): string {
  return isPctCategory(key) ? `±${band} pp` : `±${band}`
}

/** Model error relative to the baseline, in percent: negative = model is better. */
export function errorDeltaPct(c: Pick<CategoryAccuracy, 'model_mae' | 'baseline_mae'>): number | null {
  if (c.model_mae == null || c.baseline_mae == null || c.baseline_mae === 0) return null
  return (c.model_mae / c.baseline_mae - 1) * 100
}

export function headline(categories: CategoryAccuracy[]): { beating: number; graded: number; avgReduction: number | null } {
  const deltas = categories.map(errorDeltaPct).filter((d): d is number => d != null)
  return {
    beating: deltas.filter(d => d < 0).length,
    graded: deltas.length,
    avgReduction: deltas.length ? -deltas.reduce((a, b) => a + b, 0) / deltas.length : null,
  }
}

export function formatSigned(value: number, digits = 1): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}`
}

export const FLAG_LABELS: Record<ProjectionFlag, string> = {
  up: 'Beating',
  down: 'Trailing',
  flat: 'On track',
}

export type PlayerFilter = 'mine' | 'rostered' | 'all'

/** Which accuracy rows the players table shows, by current fantasy roster
 *  (looked up from the league players list by ESPN athlete id). */
export function filterByRoster<T extends { player_id: number }>(
  rows: T[],
  roster: Player[] | undefined,
  filter: PlayerFilter,
  myTeamId: number | null,
): T[] {
  if (filter === 'all' || !roster) return rows
  const owners = new Map<number, Player>()
  for (const p of roster) if (p.player_id != null) owners.set(p.player_id, p)
  return rows.filter(r => {
    const p = owners.get(r.player_id)
    if (!p || p.status !== 'ONTEAM') return false
    return filter === 'rostered' || p.team_id === myTeamId
  })
}

export function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

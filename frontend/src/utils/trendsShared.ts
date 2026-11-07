import type { MinutesMoverItem, UsageRoleItem, RegressionStatItem, RegressionStat, RegressionMode, CategoryMoverItem, CategoryStatItem } from '../types/api'

/**
 * Tabs, filters and sort keys of the Trends page, shared by the desktop
 * tables (pages/Trends.tsx) and the phone layout (mobile/trends).
 */

export type TabKey = 'minutes' | 'usage' | 'categories' | 'shooting-season' | 'shooting-form'
export type Ownership = 'all' | 'fa' | 'rostered'

export const TABS: [TabKey, string, string][] = [
  ['minutes', 'Minutes Movers', 'Who is playing more or fewer minutes than their season average'],
  ['usage', 'Usage & Role', 'Whose share of their team’s possessions has moved'],
  ['categories', 'Categories', 'Whose per-game output in your league’s counting categories (PTS, REB, AST, 3PM, STL, BLK, TO) has moved'],
  ['shooting-season', 'Shooting · Season', "Whose season shooting line is out of step with their history — the number that will look different by the time you trade them."],
  ['shooting-form', 'Shooting · Form', "Who is genuinely shooting above or below their own level right now, judged against everything outside the recency window. Small samples are filtered out by significance, not by a fixed attempt count."],
]

export const TAB_MODE: Partial<Record<TabKey, RegressionMode>> = {
  'shooting-season': 'season',
  'shooting-form': 'form',
}

export const ALL_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C']

export const BASELINE_OPTIONS: [number, string, string][] = [
  [2, 'Prior 2 seasons', 'Measured against the two seasons before this one, attempt-weighted. Bigger sample, survives one fluky year, but slow to accept a genuine change in the shooter.'],
  [1, 'Last season only', 'Measured against last season alone. Reacts faster to a real change, noisier for low-volume shooters.'],
]

// mode='form' only: no prior seasons at all, so the window is judged against
// this season alone. Right when a player's level has genuinely moved (new role,
// new team, second-year jump) and his older seasons no longer describe him.
export const FORM_BASELINE_OPTIONS: [number, string, string][] = [
  [0, 'This season', 'The window measured against the rest of this season only. Follows a player whose level has actually changed; ignores who he used to be.'],
  ...BASELINE_OPTIONS.map(([v, l, h]) => [v, l, `${h} Pooled with this season up to the window.`] as [number, string, string]),
]

export const OWNERSHIP_OPTIONS: [Ownership, string][] = [
  ['all', 'All players'],
  ['fa', 'Free agents'],
  ['rostered', 'Rostered'],
]

export interface Filters {
  nameFilter: string
  position: string | null
  minG15: number
  ownership: Ownership
  fantasyTeam: string | null
}

export interface SharedFilterable {
  player_name: string
  position: string
  fantasy_status: string
  games_last_15d: number
}

export function passesShared<T extends SharedFilterable>(
  row: T,
  { nameFilter, position, minG15, ownership, fantasyTeam }: Filters
): boolean {
  if (position && row.position !== position) return false
  if (row.games_last_15d < minG15) return false
  if (ownership === 'fa' && row.fantasy_status !== 'FA') return false
  if (ownership === 'rostered' && row.fantasy_status === 'FA') return false
  if (fantasyTeam && row.fantasy_status !== fantasyTeam) return false
  if (nameFilter.trim() && !row.player_name.toLowerCase().includes(nameFilter.trim().toLowerCase())) return false
  return true
}

export const MIN_SORT_VAL: Record<string, (r: MinutesMoverItem) => number | string> = {
  player: r => r.player_name,
  team: r => r.pro_team,
  pos: r => r.position,
  season: r => r.season_mpg,
  l5: r => r.l5_mpg,
  delta: r => r.delta_mpg,
  gp: r => r.season_gp,
  g15: r => r.games_last_15d,
}

export const USG_SORT_VAL: Record<string, (r: UsageRoleItem) => number | string> = {
  player: r => r.player_name,
  team: r => r.pro_team,
  season: r => r.season_usg,
  l5: r => r.l5_usg,
  delta: r => r.delta_usg,
  dmpg: r => r.delta_mpg,
  g15: r => r.games_last_15d,
}

export interface CategoryRow {
  item: CategoryMoverItem
  stat: CategoryStatItem
}

export const CAT_SORT_VAL: Record<string, (r: CategoryRow) => number | string> = {
  player: r => r.item.player_name,
  team: r => r.item.pro_team,
  season: r => r.stat.season_avg,
  l5: r => r.stat.window_avg,
  delta: r => r.stat.delta,
  dmpg: r => r.item.window_mpg - r.item.season_mpg,
  g15: r => r.item.games_last_15d,
}

export const REG_SORT_VAL: Record<string, (s: RegressionStatItem) => number | string> = {
  stat: s => s.stat,
  cur: s => s.current_pct,
  base: s => s.baseline_pct,
  dev: s => s.dev,
  att: s => s.attempts_per_game,
  drift: s => s.drift_score,
  z: s => Math.abs(s.z ?? 0),  // magnitude, so an ice-cold stretch ranks with a red-hot one
  impact: s => normalizeDelta(s),
}

export const MAKES_LABEL: Record<RegressionStat, string> = { '3P%': '3PM', 'FT%': 'FTM', 'FG%': 'FGM' }

// Expected change in makes per game if the stat snaps back to the baseline, at
// current attempt volume — same unit for all three stats so they compare.
export function normalizeDelta(stat: RegressionStatItem): number {
  return (-stat.dev / 100) * stat.attempts_per_game
}

export const WINDOW_OPTIONS = [7, 15, 30] as const

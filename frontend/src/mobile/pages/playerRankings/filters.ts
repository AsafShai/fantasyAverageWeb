import type { Team } from '../../../types/api'

/** null = everyone, 0 = free agents / waivers, 'rostered' = on any fantasy team. */
export type FantasyTeamFilter = number | 'rostered' | null

/** Today's Player Rankings filters (values + setters), owned by the page. */
export interface RankingsFilters {
  positions: string[]
  setPositions: (v: string[]) => void
  fantasyTeam: FantasyTeamFilter
  setFantasyTeam: (v: FantasyTeamFilter) => void
  displayLimit: number | null
  setDisplayLimit: (v: number | null) => void
  minGp: number
  setMinGp: (v: number) => void
  minMin: number
  setMinMin: (v: number) => void
}

export const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C']
export const LIMITS = [50, 100, 150, 200]

function fantasyLabel(v: FantasyTeamFilter, teams: Team[]): string {
  if (v === null) return 'All'
  if (v === 'rostered') return 'Rostered'
  if (v === 0) return 'Free Agents / Waivers'
  return teams.find((t) => t.team_id === v)?.team_name ?? `Team ${v}`
}

/** Chips for the filters that differ from the defaults; tapping one clears it. */
export function activeFilterChips(f: RankingsFilters, teams: Team[]) {
  const out: { key: string; label: string; clear: () => void }[] = []
  for (const pos of f.positions) out.push({ key: `pos-${pos}`, label: pos, clear: () => f.setPositions(f.positions.filter((p) => p !== pos)) })
  if (f.fantasyTeam !== null) out.push({ key: 'fan', label: fantasyLabel(f.fantasyTeam, teams), clear: () => f.setFantasyTeam(null) })
  if (f.displayLimit !== null) out.push({ key: 'show', label: `Top ${f.displayLimit}`, clear: () => f.setDisplayLimit(null) })
  if (f.minGp > 0) out.push({ key: 'gp', label: `Min GP ${f.minGp}`, clear: () => f.setMinGp(0) })
  if (f.minMin > 0) out.push({ key: 'mpg', label: `Min MPG ${f.minMin}`, clear: () => f.setMinMin(0) })
  return out
}

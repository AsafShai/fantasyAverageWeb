import type { Team } from '../../../types/api'

/**
 * Fantasy team filter on Player Rankings:
 * - null = all players
 * - 'rostered' = any rostered player (team_id !== 0)
 * - 0 = free agents / waivers only
 * - number[] = one or more fantasy teams (multi-select; exclusive with presets above)
 */
export type FantasyTeamFilter = null | 'rostered' | 0 | number[]

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

export function parseFantasyTeamFilter(raw: unknown): FantasyTeamFilter {
  if (raw === null) return null
  if (raw === 'rostered') return 'rostered'
  if (raw === 0) return 0
  if (Array.isArray(raw)) {
    const ids = raw.filter((id): id is number => typeof id === 'number' && id > 0)
    return ids.length ? ids : null
  }
  if (typeof raw === 'number') return raw > 0 ? [raw] : 0
  return null
}

export function isFantasyTeamMulti(filter: FantasyTeamFilter): filter is number[] {
  return Array.isArray(filter)
}

export function matchesFantasyTeam(teamId: number, filter: FantasyTeamFilter): boolean {
  if (filter === null) return true
  if (filter === 'rostered') return teamId !== 0
  if (filter === 0) return teamId === 0
  return filter.includes(teamId)
}

export function fantasyTeamPresetSelected(filter: FantasyTeamFilter, preset: null | 'rostered' | 0): boolean {
  if (preset === null) return filter === null
  return filter === preset
}

export function fantasyTeamChipSelected(filter: FantasyTeamFilter, teamId: number): boolean {
  return isFantasyTeamMulti(filter) && filter.includes(teamId)
}

export function setFantasyTeamPreset(_current: FantasyTeamFilter, preset: null | 'rostered' | 0): FantasyTeamFilter {
  return preset
}

export function toggleFantasyTeamSelection(filter: FantasyTeamFilter, teamId: number): FantasyTeamFilter {
  const base = isFantasyTeamMulti(filter) ? filter : []
  const next = base.includes(teamId) ? base.filter((id) => id !== teamId) : [...base, teamId]
  return next.length ? next : null
}

function fantasyLabelSingle(v: Exclude<FantasyTeamFilter, number[]>, teams: Team[]): string {
  if (v === null) return 'All'
  if (v === 'rostered') return 'Rostered'
  if (v === 0) return 'Free Agents / Waivers'
  return teams.find((t) => t.team_id === v)?.team_name ?? `Team ${v}`
}

export function fantasyFilterLabel(filter: FantasyTeamFilter, teams: Team[]): string {
  if (isFantasyTeamMulti(filter)) {
    if (filter.length === 1) {
      return teams.find((t) => t.team_id === filter[0])?.team_name ?? `Team ${filter[0]}`
    }
    return `${filter.length} teams`
  }
  return fantasyLabelSingle(filter, teams)
}

/** Chips for the filters that differ from the defaults; tapping one clears it. */
export function activeFilterChips(f: RankingsFilters, teams: Team[]) {
  const out: { key: string; label: string; clear: () => void }[] = []
  for (const pos of f.positions) {
    out.push({ key: `pos-${pos}`, label: pos, clear: () => f.setPositions(f.positions.filter((p) => p !== pos)) })
  }
  if (isFantasyTeamMulti(f.fantasyTeam)) {
    for (const id of f.fantasyTeam) {
      const name = teams.find((t) => t.team_id === id)?.team_name ?? `Team ${id}`
      out.push({
        key: `fan-${id}`,
        label: name,
        clear: () => f.setFantasyTeam(toggleFantasyTeamSelection(f.fantasyTeam, id)),
      })
    }
  } else if (f.fantasyTeam !== null) {
    out.push({
      key: 'fan',
      label: fantasyFilterLabel(f.fantasyTeam, teams),
      clear: () => f.setFantasyTeam(null),
    })
  }
  if (f.displayLimit !== null) out.push({ key: 'show', label: `Top ${f.displayLimit}`, clear: () => f.setDisplayLimit(null) })
  if (f.minGp > 0) out.push({ key: 'gp', label: `Min GP ${f.minGp}`, clear: () => f.setMinGp(0) })
  if (f.minMin > 0) out.push({ key: 'mpg', label: `Min MPG ${f.minMin}`, clear: () => f.setMinMin(0) })
  return out
}

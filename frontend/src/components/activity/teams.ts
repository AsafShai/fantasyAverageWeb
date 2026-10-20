import type { ActivityTeam } from '../../types/activity'

export type TeamLookup = Map<number, ActivityTeam>

export function teamLookup(teams: ActivityTeam[]): TeamLookup {
  return new Map(teams.map(t => [t.team_id, t]))
}

export function teamAbbrev(teams: TeamLookup, id: number): string {
  return teams.get(id)?.abbrev ?? `#${id}`
}

export function teamName(teams: TeamLookup, id: number): string {
  return teams.get(id)?.name ?? `Team ${id}`
}

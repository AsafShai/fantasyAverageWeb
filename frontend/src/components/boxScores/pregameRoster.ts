import type { Player, TeamDepthChart } from '../../types/api'
import type { BoxScoreGame } from '../../types/boxScore'
import { fantasyProTeam } from './proTeam'

export interface PregamePlayer {
  playerId: number | null
  name: string
  position: string
  fantasyTeam: string | null
  fantasyTeamName: string | null
  /** On a fantasy roster. Free agents and players the pool does not know are not. */
  rostered: boolean
  /** Questionable, Doubtful, and the like. Out players are omitted instead. */
  injury: string | null
}

/** The official report uses "Out". Anything else, including Available, stays. */
export function isOutStatus(status: string | null | undefined): boolean {
  return (status ?? '').trim().toLowerCase() === 'out'
}

/** A status worth showing next to a name. Out is filtered earlier; Available is not an injury. */
export function visibleInjury(status: string | null | undefined): string | null {
  const value = status?.trim() ?? ''
  if (!value || isOutStatus(value) || value.toLowerCase() === 'available') return null
  return value
}

export function outPlayerIds(charts: Array<TeamDepthChart | undefined>): Set<string> {
  const ids = new Set<string>()
  for (const chart of charts) {
    for (const position of chart?.positions ?? []) {
      for (const athlete of position.players) {
        if (athlete.id && isOutStatus(athlete.injury?.status)) ids.add(String(athlete.id))
      }
    }
  }
  return ids
}

/** Depth-chart players, minus anyone listed Out. Unrostered players are marked FA. */
export function rosterSide(
  chart: TeamDepthChart,
  players: Player[],
  abbrev: Map<number, string>,
  names: Map<number, string>,
): PregamePlayer[] {
  const byId = new Map<string, Player>()
  for (const player of players) {
    if (player.player_id != null) byId.set(String(player.player_id), player)
  }
  const seen = new Set<string>()
  const rows: PregamePlayer[] = []
  for (const position of chart.positions) {
    for (const athlete of position.players) {
      if (!athlete.id || seen.has(athlete.id)) continue
      seen.add(athlete.id)
      if (isOutStatus(athlete.injury?.status)) continue
      const match = byId.get(athlete.id)
      const owned = Boolean(match && match.team_id !== 0 && match.status !== 'FREEAGENT')
      const code = owned && match ? abbrev.get(match.team_id) || null : null
      rows.push({
        playerId: Number(athlete.id) || null,
        name: athlete.display_name,
        position: match?.positions.filter(Boolean).join('/') || position.abbreviation,
        fantasyTeam: code,
        fantasyTeamName: owned && match ? match.fantasy_team_name || names.get(match.team_id) || code : null,
        rostered: owned,
        injury: visibleInjury(athlete.injury?.status),
      })
    }
  }
  return rows.sort((a, b) => (a.fantasyTeam ?? '\uffff').localeCompare(b.fantasyTeam ?? '\uffff') || a.name.localeCompare(b.name))
}

/**
 * How many of these roster players have a team in the game. Before tip, a
 * player the injury report lists as Out does not count.
 */
export function mineCount(
  game: BoxScoreGame,
  players: { player_id?: number | null; pro_team: string }[],
  outIds: ReadonlySet<string>,
): number {
  const teams = new Set([
    fantasyProTeam(game.away.abbreviation),
    fantasyProTeam(game.home.abbreviation),
  ])
  let count = 0
  for (const player of players) {
    if (!player.pro_team || !teams.has(player.pro_team)) continue
    if (game.status === 'scheduled' && player.player_id != null && outIds.has(String(player.player_id))) continue
    count += 1
  }
  return count
}

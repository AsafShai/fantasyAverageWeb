import type { Player } from '../types/api'
import type { InjuryRecord } from '../types/injury'
import { normalizePlayerName } from './playerName'

/**
 * Injury semantics for hints match the Injuries page: `GET /injuries/` only.
 * Do not use ESPN `player.injured` or matchup injury_status.
 */

/** Same unhealthy statuses as the Injuries page filters (excludes Available). */
const INJURY_REPORT_UNHEALTHY = new Set(['out', 'doubtful', 'questionable', 'probable'])

/** Same normalization as the Injuries page team filter (full name or abbr). */
export function injuryReportTeamKey(team: string): string {
  return team.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function buildInjuryReportTeamKeys(records: InjuryRecord[]): Set<string> {
  const keys = new Set<string>()
  for (const row of records) {
    const team = row.team?.trim()
    if (team) keys.add(injuryReportTeamKey(team))
  }
  return keys
}

/** True when the injury PDF includes at least one row for this NBA team (by abbr or full name). */
export function isProTeamOnInjuryReport(
  proTeam: string | null | undefined,
  reportTeamKeys: Set<string>,
  nbaTeams?: readonly { abbreviation: string; team_name: string }[],
): boolean {
  const abbr = proTeam?.trim()
  if (!abbr || abbr === 'FA' || reportTeamKeys.size === 0) return false
  const candidates = [injuryReportTeamKey(abbr)]
  const meta = nbaTeams?.find((t) => t.abbreviation === abbr)
  if (meta?.team_name) candidates.push(injuryReportTeamKey(meta.team_name))
  return candidates.some((k) => reportTeamKeys.has(k))
}

export function buildInjuryStatusByPlayerName(records: InjuryRecord[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const row of records) {
    if (!row.status?.trim()) continue
    map.set(normalizePlayerName(row.player), row.status.trim())
  }
  return map
}

export function injuryStatusForPlayer(
  player: Pick<Player, 'player_name'>,
  injuryByPlayerName: Map<string, string> | undefined,
): string | undefined {
  if (!injuryByPlayerName) return undefined
  return injuryByPlayerName.get(normalizePlayerName(player.player_name))
}

export function isInjuryReportUnhealthyStatus(status: string | null | undefined): boolean {
  if (!status?.trim()) return false
  return INJURY_REPORT_UNHEALTHY.has(status.trim().toLowerCase())
}

/** True when the player appears on the injury report with Out / Doubtful / Questionable / Probable. */
export function isPlayerInjuryReportUnhealthy(
  player: Pick<Player, 'player_name'>,
  injuryByPlayerName?: Map<string, string>,
): boolean {
  return isInjuryReportUnhealthyStatus(injuryStatusForPlayer(player, injuryByPlayerName))
}

/** Injury report lists the player as Out (excluded from “plays tonight” lineup hints). */
export function isPlayerOutOnInjuryReport(
  player: Pick<Player, 'player_name'>,
  injuryByPlayerName?: Map<string, string>,
): boolean {
  const status = injuryStatusForPlayer(player, injuryByPlayerName)
  return status?.trim().toLowerCase() === 'out'
}

import type { ActivityMove, ActivityTeam, LeagueActivity } from '../types/activity'
import type { DraftPick, Player } from '../types/api'
import { buildSeasonValueRankByName, REPORT_MIN_GP } from './draftReport'
import { normalizePlayerName } from './playerName'

/** Undrafted FA report only lists players ranked this high or better in the season value pool. */
export const FA_REPORT_MAX_SEASON_RANK = 200

export interface LastFaPickup {
  at: string
  team_id: number
  team_name: string
  kind: 'add' | 'waiver'
}

export interface FaReportRow {
  player_id: number | null
  player_name: string
  pro_team: string
  fantasy_status: Player['status']
  gp: number
  totalZ: number | null
  valueRank: number | null
  lastFaPickup: LastFaPickup | null
}

export function buildDraftedNameKeys(picks: DraftPick[]): Set<string> {
  return new Set(picks.map(p => normalizePlayerName(p.player_name)))
}

/** Most recent add or waiver claim per player (free-agent acquisitions). */
export function buildLastFaPickupByPlayerId(
  moves: ActivityMove[],
  teams: ActivityTeam[],
): Map<number, LastFaPickup> {
  const teamName = new Map(teams.map(t => [t.team_id, t.name]))
  const sorted = [...moves].sort((a, b) => a.at.localeCompare(b.at))
  const last = new Map<number, LastFaPickup>()
  for (const move of sorted) {
    if (move.kind !== 'add' && move.kind !== 'waiver') continue
    const team_name = teamName.get(move.team_id) ?? `Team ${move.team_id}`
    for (const added of move.added) {
      last.set(added.player_id, {
        at: move.at,
        team_id: move.team_id,
        team_name,
        kind: move.kind,
      })
    }
  }
  return last
}

export function buildFaReportRows(
  draftPicks: DraftPick[],
  allPlayers: Player[],
  activity: LeagueActivity | undefined,
  calcMode: 'totals' | 'per_game',
): FaReportRow[] {
  const drafted = buildDraftedNameKeys(draftPicks)
  const valueByName = buildSeasonValueRankByName(allPlayers, calcMode, REPORT_MIN_GP)
  const lastFa = activity
    ? buildLastFaPickupByPlayerId(activity.moves, activity.teams)
    : new Map<number, LastFaPickup>()

  const rows: FaReportRow[] = []
  for (const player of allPlayers) {
    const key = normalizePlayerName(player.player_name)
    if (drafted.has(key)) continue
    if (player.stats.gp < REPORT_MIN_GP) continue
    const value = valueByName.get(key)
    const rank = value?.valueRank ?? null
    if (rank === null || rank > FA_REPORT_MAX_SEASON_RANK) continue
    const pid = player.player_id ?? null
    rows.push({
      player_id: pid,
      player_name: player.player_name,
      pro_team: player.pro_team,
      fantasy_status: player.status,
      gp: player.stats.gp,
      totalZ: value?.totalZ ?? null,
      valueRank: rank,
      lastFaPickup: pid != null ? lastFa.get(pid) ?? null : null,
    })
  }

  return rows.sort((a, b) => {
    const ar = a.valueRank ?? Number.MAX_SAFE_INTEGER
    const br = b.valueRank ?? Number.MAX_SAFE_INTEGER
    if (ar !== br) return ar - br
    return a.player_name.localeCompare(b.player_name)
  })
}

export function formatFaPickupDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

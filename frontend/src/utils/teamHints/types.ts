import type { Player, RosterDay, TeamDetail } from '../../types/api'

export type HintCategory = 'lineup' | 'schedule' | 'roster'

export type HintSeverity = 'opportunity' | 'warning' | 'info'

export type RankWindowKey = 'season' | 'last_15'

export interface PlayerRankRef {
  rank: number
  window: RankWindowKey
  /** True when rank came from ESPN ratings instead of site z-scores. */
  espnFallback?: boolean
}

export interface RankLookups {
  season: Map<number, PlayerRankRef>
  last15: Map<number, PlayerRankRef>
  poolSizeSeason: number
  poolSizeLast15: number
}

export interface HintPlayerRankChip {
  rank: number
  espnFallback?: boolean
}

export interface HintPlayerRanks {
  season?: HintPlayerRankChip
  last15?: HintPlayerRankChip
}

export interface HintPlayerLine {
  playerId?: number | null
  name: string
  lineupSlot?: string | null
  injuryStatus?: string | null
  ranks?: HintPlayerRanks
  notes?: string[]
}

export interface TeamHintsInput {
  teamDetail: TeamDetail
  ranks: RankLookups
  /** GP in the last-15 stats window (from the last_15 players pool), keyed by player_id. */
  last15GpByPlayerId?: Map<number, number>
  rosterDay?: RosterDay | null
  injuryStatusByPlayerName?: Map<string, string>
  injuryReportTeamKeys?: Set<string>
  nbaTeams?: readonly { abbreviation: string; team_name: string }[]
}

export interface TeamHint {
  id: string
  category: HintCategory
  severity: HintSeverity
  priority: number
  title: string
  body: string
  players?: HintPlayerLine[]
  playerIds?: number[]
  evidence?: Record<string, unknown>
}

export type RosterPlayer = Player & { lineup_slot?: string | null }

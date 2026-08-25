export const STORAGE_KEY = 'ffEspnRankingsPayload'

export const FF_MSG = {
  PING: 'FF_ESPN_RANKINGS_PING',
  PONG: 'FF_ESPN_RANKINGS_PONG',
  APPLY: 'FF_ESPN_RANKINGS_APPLY',
  STORED: 'FF_ESPN_RANKINGS_STORED',
  READY: 'FF_ESPN_RANKINGS_READY',
  RUN: 'FF_ESPN_RANKINGS_RUN',
  STOP: 'FF_ESPN_RANKINGS_STOP',
  PROGRESS: 'FF_ESPN_RANKINGS_PROGRESS',
  RESULT: 'FF_ESPN_RANKINGS_RESULT',
} as const

export type RankedPlayer = {
  rank: number
  espnId: number | null
  name: string
  team: string
}

export type RankingsPayload = {
  version: 1
  source: 'pre-draft-rankings'
  savedAt: string
  players: RankedPlayer[]
}

export type EspnBoardRow = {
  espnId: number | null
  name: string
  team: string
  index: number
}

export function isRankingsPayload(value: unknown): value is RankingsPayload {
  if (!value || typeof value !== 'object') return false
  const v = value as RankingsPayload
  if (v.version !== 1 || !Array.isArray(v.players)) return false
  if (v.source != null && v.source !== 'pre-draft-rankings') return false
  return v.players.every((player) => {
    if (!player || typeof player !== 'object') return false
    if (typeof player.name !== 'string' || !player.name.trim()) return false
    if (!Number.isInteger(player.rank) || player.rank < 1) return false
    if (player.espnId != null && (!Number.isInteger(player.espnId) || player.espnId <= 0)) return false
    if (typeof player.team !== 'string') return false
    return true
  })
}

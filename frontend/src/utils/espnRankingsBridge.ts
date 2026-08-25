export const FF_ESPN_MSG = {
  PING: 'FF_ESPN_RANKINGS_PING',
  PONG: 'FF_ESPN_RANKINGS_PONG',
  APPLY: 'FF_ESPN_RANKINGS_APPLY',
  STORED: 'FF_ESPN_RANKINGS_STORED',
} as const

export type EspnRankingsPlayer = {
  rank: number
  espnId: number | null
  name: string
  team: string
}

export type EspnRankingsPayload = {
  version: 1
  source: 'pre-draft-rankings'
  savedAt: string
  players: EspnRankingsPlayer[]
}

type PlayerLike = {
  id: string
  espn_id: number | null
  name: string
  team_abbr?: string | null
}

export function espnIdOf(player: PlayerLike): number | null {
  if (player.espn_id != null && Number.isFinite(player.espn_id)) return player.espn_id
  if (/^\d+$/.test(player.id)) return Number(player.id)
  return null
}

export function toEspnRankingsPayload(players: PlayerLike[]): EspnRankingsPayload {
  return {
    version: 1,
    source: 'pre-draft-rankings',
    savedAt: new Date().toISOString(),
    players: players.map((player, i) => ({
      rank: i + 1,
      espnId: espnIdOf(player),
      name: player.name,
      team: player.team_abbr ?? '',
    })),
  }
}

export function pingEspnHelper(timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const onMsg = (event: MessageEvent) => {
      if (event.source !== window) return
      if (event.data?.type === FF_ESPN_MSG.PONG) {
        window.removeEventListener('message', onMsg)
        resolve(true)
      }
    }
    window.addEventListener('message', onMsg)
    window.postMessage({ type: FF_ESPN_MSG.PING }, '*')
    window.setTimeout(() => {
      window.removeEventListener('message', onMsg)
      resolve(false)
    }, timeoutMs)
  })
}

export function sendEspnRankings(payload: EspnRankingsPayload, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const onMsg = (event: MessageEvent) => {
      if (event.source !== window) return
      if (event.data?.type === FF_ESPN_MSG.STORED) {
        window.removeEventListener('message', onMsg)
        resolve(true)
      }
    }
    window.addEventListener('message', onMsg)
    window.postMessage({ type: FF_ESPN_MSG.APPLY, payload }, '*')
    window.setTimeout(() => {
      window.removeEventListener('message', onMsg)
      resolve(false)
    }, timeoutMs)
  })
}

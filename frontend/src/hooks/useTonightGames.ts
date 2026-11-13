import { useGetBoxScoreboardQuery, useGetCurrentSlateDateQuery } from '../store/api/fantasyApi'
import type { BoxScoreGame } from '../types/boxScore'

export interface TonightGame {
  id: string
  name: string
  status: 'scheduled' | 'live' | 'final'
  label: string
}

function startLabel(g: BoxScoreGame): string {
  const d = new Date(g.start_time)
  return Number.isNaN(d.getTime()) ? g.status_detail : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** Tonight's games for the live badge's tap sheet: the slate's scoreboard, fetched only while `enabled`. */
export function useTonightGames(enabled: boolean, noSpoilers: boolean): { games: TonightGame[]; isLoading: boolean } {
  const slate = useGetCurrentSlateDateQuery(undefined, { skip: !enabled })
  const date = slate.data ?? ''
  const board = useGetBoxScoreboardQuery(date, { skip: !enabled || !date })
  const games = (board.data?.games ?? []).map((g): TonightGame => ({
    id: g.game_id,
    name: `${g.away.abbreviation} @ ${g.home.abbreviation}`,
    status: g.status,
    label: g.status === 'final' ? 'Final'
      : g.status === 'live' ? (noSpoilers ? 'In progress' : g.status_detail)
      : startLabel(g),
  }))
  return { games, isLoading: enabled && (slate.isLoading || board.isLoading) }
}

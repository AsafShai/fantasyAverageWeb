import { useGetBoxScoreboardQuery, useGetCurrentSlateDateQuery } from '../store/api/fantasyApi'
import { gameClockLabel } from '../components/boxScores/tipTime'

export interface TonightGame {
  id: string
  name: string
  status: 'scheduled' | 'live' | 'final'
  /** "102–110", away first; null before tip and in No spoilers. */
  score: string | null
  /** Tip time, clock, or Final. No spoilers says only Live / Final, as Box Scores does. */
  label: string
  /** Box Scores, opened on this game. */
  href: string
}

/**
 * The games the live badge counts, for its tap sheet, fetched only while `enabled`.
 * `liveDate` is the live block's slate_date: the night being counted, kept after
 * every game is final until ESPN goes official. (The current slate date moves on
 * to the next, still upcoming, slate in the morning.) Older backends omit it.
 */
export function useTonightGames(enabled: boolean, noSpoilers: boolean, liveDate?: string | null): { games: TonightGame[]; isLoading: boolean } {
  const slate = useGetCurrentSlateDateQuery(undefined, { skip: !enabled || !!liveDate })
  const date = liveDate || slate.data || ''
  const board = useGetBoxScoreboardQuery(date, { skip: !enabled || !date })
  const games = (board.data?.games ?? []).map((g): TonightGame => {
    const hide = noSpoilers && g.status !== 'scheduled'
    const scored = g.status !== 'scheduled' && g.away.score != null && g.home.score != null
    return {
      id: g.game_id,
      name: `${g.away.abbreviation} @ ${g.home.abbreviation}`,
      status: g.status,
      score: scored && !hide ? `${g.away.score}–${g.home.score}` : null,
      label: gameClockLabel(g.status, g.status_detail, g.start_time, hide),
      href: `/box-scores?date=${date}&game=${g.game_id}`,
    }
  })
  return { games, isLoading: enabled && (slate.isLoading || board.isLoading) }
}

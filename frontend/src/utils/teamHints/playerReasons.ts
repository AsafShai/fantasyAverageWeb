import { injuryStatusForPlayer } from '../playerInjury'
import { formatRankShort, rankForPlayer } from './ranks'
import type { HintPlayerLine, HintPlayerRankChip, PlayerRankRef, RankLookups, RosterPlayer } from './types'

function chipFromRef(ref: ReturnType<typeof rankForPlayer>): HintPlayerRankChip | undefined {
  if (!ref) return undefined
  return { rank: ref.rank, espnFallback: ref.espnFallback }
}

export function buildHintPlayerLine(
  player: RosterPlayer,
  ranks: RankLookups,
  injuryByPlayerName?: Map<string, string>,
  notes: string[] = [],
): HintPlayerLine {
  return {
    playerId: player.player_id,
    name: player.player_name,
    lineupSlot: player.lineup_slot ?? null,
    injuryStatus: injuryStatusForPlayer(player, injuryByPlayerName) ?? null,
    ranks: {
      season: chipFromRef(rankForPlayer(ranks, player, 'season')),
      last15: chipFromRef(rankForPlayer(ranks, player, 'last_15')),
    },
    notes: notes.filter(Boolean),
  }
}

export function heatingReason(player: RosterPlayer, ranks: RankLookups, minDelta: number): string | null {
  const season = rankForPlayer(ranks, player, 'season')
  const l15 = rankForPlayer(ranks, player, 'last_15')
  if (!season || !l15) return null
  const delta = season.rank - l15.rank
  if (delta < minDelta) return null
  return `Recent form: heating up (#${l15.rank} over last 15 vs #${season.rank} for the season)`
}

/** Row-2 copy for consider start/bench (not matchup). */
export function hasLineupValueExplanation(notes: string[]): boolean {
  return notes.some(
    (n) =>
      n.startsWith('Recent form:') ||
      n.startsWith('Season value is weak') ||
      n.startsWith('Strong last 15 days:'),
  )
}

export function strongL15StartExplanation(l15: PlayerRankRef): string {
  return `Strong last 15 days: ${formatRankShort(l15)}`
}

export function coolingReason(
  player: RosterPlayer,
  ranks: RankLookups,
  minDelta: number,
  /** When set, skip “cooling” if L15 is still this good (rank ≤ cutoff). Used for bench hints. */
  minL15RankForCooling?: number,
): string | null {
  const season = rankForPlayer(ranks, player, 'season')
  const l15 = rankForPlayer(ranks, player, 'last_15')
  if (!season || !l15) return null
  const delta = l15.rank - season.rank
  if (delta < minDelta) return null
  if (minL15RankForCooling != null && l15.rank < minL15RankForCooling) return null
  return `Recent form: cooling off (was #${season.rank} for the season, now #${l15.rank} over last 15)`
}

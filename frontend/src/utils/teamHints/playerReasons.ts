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

export function considerStartRankNotes(
  season: PlayerRankRef | null | undefined,
  l15: PlayerRankRef | null | undefined,
  seasonMax: number,
  l15Max: number,
): string[] {
  const notes: string[] = []
  if (season && season.rank <= seasonMax) {
    notes.push(`Season rank in top ${seasonMax}: ${formatRankShort(season)}`)
  }
  if (l15 && l15.rank <= l15Max) {
    notes.push(`Last 15 rank in top ${l15Max}: ${formatRankShort(l15)}`)
  }
  return notes
}

export function considerBenchRankNotes(
  season: PlayerRankRef | null | undefined,
  l15: PlayerRankRef | null | undefined,
  seasonOutsideTop: number,
  l15OutsideTop: number,
): string[] {
  const notes: string[] = []
  if (season && season.rank > seasonOutsideTop) {
    notes.push(`Season rank outside top ${seasonOutsideTop}: ${formatRankShort(season)}`)
  }
  if (l15 && l15.rank > l15OutsideTop) {
    notes.push(`Last 15 rank outside top ${l15OutsideTop}: ${formatRankShort(l15)}`)
  }
  return notes
}

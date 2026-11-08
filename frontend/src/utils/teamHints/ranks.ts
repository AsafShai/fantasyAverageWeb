import type { PaginatedPlayers, Player } from '../../types/api'
import {
  buildPerGameValueRanksByPlayerId,
  DEFAULT_CATEGORIES,
  type RankingCategory,
} from '../playerRankings'
import type { PlayerRankRef, RankLookups, RankWindowKey, RosterPlayer } from './types'

function categoriesFromPool(meta?: Pick<PaginatedPlayers, 'categories' | 'reverse_categories'>): {
  categories: RankingCategory[]
  reverse: Set<RankingCategory>
} {
  const categories = (meta?.categories?.length ? meta.categories : DEFAULT_CATEGORIES) as RankingCategory[]
  const reverse = new Set((meta?.reverse_categories ?? []) as RankingCategory[])
  return { categories, reverse }
}

function buildRankMap(
  allPlayers: Player[],
  window: RankWindowKey,
  categories: RankingCategory[],
  reverseCategories: Set<RankingCategory>,
): { map: Map<number, PlayerRankRef>; poolSize: number } {
  const byId = buildPerGameValueRanksByPlayerId(allPlayers, categories, reverseCategories)
  const map = new Map<number, PlayerRankRef>()
  for (const [id, entry] of byId) {
    map.set(id, { rank: entry.rank, window })
  }
  return { map, poolSize: map.size }
}

export function buildRankLookups(
  seasonPool: Player[],
  last15Pool: Player[],
  meta?: Pick<PaginatedPlayers, 'categories' | 'reverse_categories'>,
): RankLookups {
  const { categories, reverse } = categoriesFromPool(meta)
  const season = buildRankMap(seasonPool, 'season', categories, reverse)
  const last15 = buildRankMap(last15Pool, 'last_15', categories, reverse)

  return {
    season: season.map,
    last15: last15.map,
    poolSizeSeason: season.poolSize,
    poolSizeLast15: last15.poolSize,
  }
}

export function rankForPlayer(lookups: RankLookups, player: RosterPlayer, window: RankWindowKey): PlayerRankRef | null {
  const id = player.player_id
  if (id == null) return null
  const table = window === 'season' ? lookups.season : lookups.last15
  return table.get(id) ?? null
}

export function formatRankShort(ref: PlayerRankRef): string {
  const windowLabel = ref.window === 'season' ? 'season' : 'L15'
  return `#${ref.rank} (${windowLabel})`
}

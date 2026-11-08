import type { PaginatedPlayers, Player } from '../../types/api'
import { HINTS_MIN_GP, HINTS_MIN_GP_L15 } from './thresholds'
import {
  computePlayerRankings,
  DEFAULT_CATEGORIES,
  partitionByDataAvailability,
  scoreAgainstPool,
  type RankingCategory,
} from '../playerRankings'
import type { PlayerRankRef, RankLookups, RankWindowKey, RosterPlayer } from './types'

const WEIGHTS = Object.fromEntries(DEFAULT_CATEGORIES.map((c) => [c, 1])) as Record<RankingCategory, number>

function categoriesFromPool(meta?: Pick<PaginatedPlayers, 'categories' | 'reverse_categories'>): {
  categories: RankingCategory[]
  reverse: Set<RankingCategory>
} {
  const categories = (meta?.categories?.length ? meta.categories : DEFAULT_CATEGORIES) as RankingCategory[]
  const reverse = new Set((meta?.reverse_categories ?? []) as RankingCategory[])
  return { categories, reverse }
}

function windowEspnRating(player: Player, window: RankWindowKey): number | null {
  if (window === 'season') return player.season_rating ?? null
  return player.last15_rating ?? null
}

function buildRankMap(
  allPlayers: Player[],
  window: RankWindowKey,
  minGp: number,
  categories: RankingCategory[],
  reverseCategories: Set<RankingCategory>,
): { map: Map<number, PlayerRankRef>; poolSize: number } {
  const { available } = partitionByDataAvailability(allPlayers)
  const ranked = computePlayerRankings(
    available,
    { calcMode: 'per_game', minGp, minMin: 0, position: null, weights: WEIGHTS },
    categories,
    reverseCategories,
  )
  const referencePool = ranked.map((r) => r.player)
  const poolSize = ranked.length

  const map = new Map<number, PlayerRankRef>()
  const qualified = available.filter((p) => p.stats.gp >= minGp)
  const zByName = new Map(ranked.map((r) => [r.player.player_name, r.totalZ]))
  const fullyRanked = qualified
    .map((p) => ({
      player: p,
      totalZ:
        zByName.get(p.player_name) ??
        scoreAgainstPool(p, referencePool, 'per_game', WEIGHTS, categories, reverseCategories),
    }))
    .sort((a, b) => b.totalZ - a.totalZ)

  for (let i = 0; i < fullyRanked.length; i++) {
    const p = fullyRanked[i].player
    const id = p.player_id
    if (id == null) continue
    map.set(id, { rank: i + 1, window })
  }

  for (const p of available) {
    const id = p.player_id
    if (id == null || map.has(id)) continue
    if (p.has_data !== false) continue
    const espn = windowEspnRating(p, window)
    if (espn == null) continue
    map.set(id, { rank: Math.round(espn), window, espnFallback: true })
  }

  return { map, poolSize }
}

export function buildRankLookups(
  seasonPool: Player[],
  last15Pool: Player[],
  meta?: Pick<PaginatedPlayers, 'categories' | 'reverse_categories'>,
): RankLookups {
  const { categories, reverse } = categoriesFromPool(meta)
  const season = buildRankMap(seasonPool, 'season', HINTS_MIN_GP, categories, reverse)
  const last15 = buildRankMap(last15Pool, 'last_15', HINTS_MIN_GP_L15, categories, reverse)

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
  return ref.espnFallback ? `#${ref.rank} (ESPN ${windowLabel})` : `#${ref.rank} (${windowLabel})`
}

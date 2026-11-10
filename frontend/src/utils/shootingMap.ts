import type { Player } from '../types/api'
import { computePlayerRankings, DEFAULT_CATEGORIES, type RankingCategory } from './playerRankings'

/*
 * Player Scatter Map: who is on the map. The top-200 fantasy pool, ranked as
 * Player Rankings, and the scope (NBA team, fantasy team, positions) a viewer
 * narrows it to. The charts themselves are in scatterMap.ts.
 */

export type ShotUnit = 'pg' | 'tot'

export const POOL_SIZE = 200
/** Games a player needs in the window; the page lets the viewer change it. */
export const DEFAULT_MIN_GP = 2

export const playerKey = (p: Player): string => (p.player_id != null ? String(p.player_id) : `${p.player_name}|${p.pro_team}`)

const DEFAULT_WEIGHTS = Object.fromEntries(DEFAULT_CATEGORIES.map(c => [c, 1])) as Record<RankingCategory, number>

export interface ShotPool {
  /** Top-200 by overall z-score, best first. */
  pool: Player[]
  /** Fantasy rank by player key, for everyone the ranking covers. */
  frank: Map<string, number>
  /** Everyone with enough games, so a team view (NBA or fantasy) can add its other players. */
  eligible: Player[]
}

/** The top-200 the map shows, ranked the same way as Player Rankings (per game, equal weights). */
export function buildShotPool(players: Player[], categories: RankingCategory[] = DEFAULT_CATEGORIES,
                              reverseCategories?: Set<RankingCategory>, minGp = DEFAULT_MIN_GP): ShotPool {
  // At least one game, so per-game stats always exist.
  const gpFloor = Math.max(1, minGp)
  const eligible = players.filter(p => p.has_data !== false && p.stats.gp >= gpFloor)
  const weights = { ...DEFAULT_WEIGHTS }
  for (const c of categories) if (!(c in weights)) weights[c] = 1
  const ranked = computePlayerRankings(eligible, { calcMode: 'per_game', minGp: gpFloor, minMin: 0, position: null, weights },
    categories, reverseCategories)
  const frank = new Map<string, number>()
  ranked.forEach((r, i) => frank.set(playerKey(r.player), i + 1))
  return { pool: ranked.slice(0, POOL_SIZE).map(r => r.player), frank, eligible }
}

/** 1 + how many pool values beat v (ties share a rank). */
export function rankIn(sortedDesc: number[], v: number): number {
  let lo = 0, hi = sortedDesc.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sortedDesc[mid] > v) lo = mid + 1
    else hi = mid
  }
  return lo + 1
}

/** A fantasy team id (0 = free agents / waivers), any rostered player, or everyone. */
export type FantasyScope = number | 'rostered' | null

/** Which players the map is about: an NBA team, a fantasy team and positions (all optional). */
export interface ShotScope {
  nba: string | null
  fantasy: FantasyScope
  /** Any of these ESPN positions; empty or absent means every position. */
  positions?: string[]
}

export const ALL_PLAYERS: ShotScope = { nba: null, fantasy: null }

export const isScoped = (scope: ShotScope): boolean => scope.nba !== null || scope.fantasy !== null

export function inScope(p: Player, scope: ShotScope): boolean {
  if (scope.nba && p.pro_team !== scope.nba) return false
  if (scope.positions?.length && !scope.positions.some(x => p.positions.includes(x))) return false
  if (scope.fantasy === 'rostered') return p.team_id !== 0
  if (scope.fantasy !== null) return p.team_id === scope.fantasy
  return true
}

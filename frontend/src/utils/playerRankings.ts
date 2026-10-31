import type { Player, PlayerStats } from '../types/api'

// A category code as used across the app (e.g. "FG%", "PTS", "TO") — this
// league's actual scoring categories, not a fixed set. Falls back to
// DEFAULT_CATEGORIES (the historical 8) wherever a definitive list from the
// API isn't available yet (e.g. before the first response lands).
export type RankingCategory = string

export const DEFAULT_CATEGORIES: RankingCategory[] = ['FG%', 'FT%', '3PM', 'REB', 'AST', 'STL', 'BLK', 'PTS']

export const PERCENTAGE_CATEGORIES = new Set(['FG%', 'FT%'])

const EMPTY_REVERSE: Set<RankingCategory> = new Set()

// Percentage categories need a paired "attempts" quantity to compute a
// makes-weighted z-score (see pctImpactArray) — FG%/FT% are the only two
// ESPN scores this way, so this pairing is inherent to the stat, not a
// hardcoded category set.
const ATTEMPT_KEY: Record<string, 'fga' | 'fta'> = { 'FG%': 'fga', 'FT%': 'fta' }

// Category codes that still have a dedicated PlayerStats field, used as a
// fallback when a player's generic `stats.stats` dict doesn't carry a given
// category (e.g. an older cached response, or a test fixture that only sets
// the fixed fields).
const FIXED_FIELD_KEY: Partial<Record<string, keyof PlayerStats>> = {
  'FG%': 'fg_percentage',
  'FT%': 'ft_percentage',
  '3PM': 'three_pm',
  AST: 'ast',
  REB: 'reb',
  STL: 'stl',
  BLK: 'blk',
  PTS: 'pts',
}

export const CATEGORY_LABELS: Record<string, string> = {
  'FG%': 'FG%',
  'FT%': 'FT%',
  '3PM': '3PM',
  AST: 'AST',
  REB: 'REB',
  STL: 'STL',
  BLK: 'BLK',
  PTS: 'PTS',
  TO: 'TO',
}

export interface RankingsConfig {
  calcMode: 'totals' | 'per_game'
  minGp: number
  minMin: number
  position: string | null
  weights: Record<RankingCategory, number>
}

export interface RankedPlayer {
  player: Player
  zScores: Record<RankingCategory, number>
  totalZ: number
}

function rawCatValue(player: Player, cat: RankingCategory): number {
  const fromGeneric = player.stats.stats?.[cat]
  if (fromGeneric !== undefined) return fromGeneric
  const fixedKey = FIXED_FIELD_KEY[cat]
  return fixedKey ? (player.stats[fixedKey] as number) : 0
}

function getCatValue(player: Player, cat: RankingCategory, calcMode: 'totals' | 'per_game'): number {
  const gp = Math.max(player.stats.gp, 1)
  const raw = rawCatValue(player, cat)
  return calcMode === 'per_game' && !PERCENTAGE_CATEGORIES.has(cat) ? raw / gp : raw
}

function pctImpactArray(pool: Player[], cat: RankingCategory, calcMode: 'totals' | 'per_game'): number[] {
  const attemptKey = ATTEMPT_KEY[cat] ?? 'fga'
  const poolMean = pool.reduce((s, p) => s + rawCatValue(p, cat), 0) / pool.length
  return pool.map(p => {
    const gp = Math.max(p.stats.gp, 1)
    const attempts = calcMode === 'per_game' ? p.stats[attemptKey] / gp : p.stats[attemptKey]
    return (rawCatValue(p, cat) - poolMean) * attempts
  })
}

function meanStdev(values: number[]): { mean: number; stdev: number } {
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
  return { mean, stdev: Math.sqrt(variance) }
}

function zScoreArray(values: number[]): number[] {
  if (values.length === 0) return []
  const { mean, stdev } = meanStdev(values)
  return values.map(v => (stdev === 0 ? 0 : (v - mean) / stdev))
}

// A reverse-scored category (e.g. TO) is better when the raw value is lower,
// so its z-scores are negated: the sign convention everywhere downstream
// (green/positive = good, and totalZ as a plain weighted sum) then holds for
// every category without each call site knowing which is which.
function categoryZArrays(pool: Player[], categories: RankingCategory[], calcMode: 'totals' | 'per_game',
                         reverseCategories: Set<RankingCategory> = EMPTY_REVERSE): number[][] {
  return categories.map(cat => {
    const z = PERCENTAGE_CATEGORIES.has(cat)
      ? zScoreArray(pctImpactArray(pool, cat, calcMode))
      : zScoreArray(pool.map(p => getCatValue(p, cat, calcMode)))
    return reverseCategories.has(cat) ? z.map(v => -v) : z
  })
}

export function computePlayerRankings(players: Player[], config: RankingsConfig, categories: RankingCategory[] = DEFAULT_CATEGORIES,
                                      reverseCategories: Set<RankingCategory> = EMPTY_REVERSE): RankedPlayer[] {
  const { calcMode, minGp, minMin, position, weights } = config

  const filtered = players.filter(p =>
    p.stats.gp >= minGp &&
    (p.stats.gp > 0 ? p.stats.minutes / p.stats.gp : 0) >= minMin &&
    (position === null || p.positions.includes(position))
  )

  if (filtered.length === 0) return []

  let referencePool: Player[]
  if (filtered.length >= 300) {
    const pass1CatZs = categoryZArrays(filtered, categories, calcMode, reverseCategories)
    const pass1Z = filtered.map((_, i) => categories.reduce((sum, cat, ci) => sum + pass1CatZs[ci][i] * weights[cat], 0) / categories.length)
    referencePool = filtered
      .map((p, i) => ({ p, z: pass1Z[i] }))
      .sort((a, b) => b.z - a.z)
      .slice(0, 300)
      .map(x => x.p)
  } else {
    referencePool = filtered
  }

  const catZs = categoryZArrays(referencePool, categories, calcMode, reverseCategories)

  return referencePool
    .map((p, i) => {
      const zScores = Object.fromEntries(
        categories.map((cat, ci) => [cat, catZs[ci][i]])
      ) as Record<RankingCategory, number>
      const totalZ = categories.reduce((sum, cat) => sum + zScores[cat] * weights[cat], 0) / categories.length
      return { player: p, zScores, totalZ }
    })
    .sort((a, b) => b.totalZ - a.totalZ)
}

export function getRawValue(player: Player, cat: RankingCategory, displayMode: 'totals' | 'per_game'): number {
  return getCatValue(player, cat, displayMode)
}

// Per-category z-scores for a player outside a ranking's referencePool (e.g.
// below the minGp cutoff, or past the top-300 cut), measured against that same
// pool's mean/stdev so they're directly comparable to the pool's own z-scores.
export function categoryZAgainstPool(player: Player, referencePool: Player[], calcMode: 'totals' | 'per_game', categories: RankingCategory[] = DEFAULT_CATEGORIES,
                                     reverseCategories: Set<RankingCategory> = EMPTY_REVERSE): Record<RankingCategory, number> {
  const entries = categories.map(cat => {
    const sign = reverseCategories.has(cat) ? -1 : 1
    if (PERCENTAGE_CATEGORIES.has(cat)) {
      const poolMean = referencePool.reduce((s, p) => s + rawCatValue(p, cat), 0) / referencePool.length
      const { mean, stdev } = meanStdev(pctImpactArray(referencePool, cat, calcMode))
      const attemptKey = ATTEMPT_KEY[cat] ?? 'fga'
      const gp = Math.max(player.stats.gp, 1)
      const attempts = calcMode === 'per_game' ? player.stats[attemptKey] / gp : player.stats[attemptKey]
      const playerImpact = (rawCatValue(player, cat) - poolMean) * attempts
      return [cat, stdev === 0 ? 0 : sign * (playerImpact - mean) / stdev] as const
    }
    const { mean, stdev } = meanStdev(referencePool.map(p => getCatValue(p, cat, calcMode)))
    const playerValue = getCatValue(player, cat, calcMode)
    return [cat, stdev === 0 ? 0 : sign * (playerValue - mean) / stdev] as const
  })
  return Object.fromEntries(entries) as Record<RankingCategory, number>
}

// Scores a player outside a ranking's referencePool against that same pool,
// so the number is directly comparable to the totalZ values
// computePlayerRankings produced for it.
export function scoreAgainstPool(player: Player, referencePool: Player[], calcMode: 'totals' | 'per_game', weights: Record<RankingCategory, number>, categories: RankingCategory[] = DEFAULT_CATEGORIES,
                                 reverseCategories: Set<RankingCategory> = EMPTY_REVERSE): number {
  const zScores = categoryZAgainstPool(player, referencePool, calcMode, categories, reverseCategories)
  return categories.reduce((sum, cat) => sum + zScores[cat] * weights[cat], 0) / categories.length
}

export interface PlayerRankSummary {
  /** 1-based overall rank, or null when the player falls outside the ranked pool. */
  rank: number | null
  /** How many players were ranked (the reference pool size). */
  poolSize: number
  totalZ: number
  zScores: Record<RankingCategory, number>
  /** 1-based rank among ranked players sharing each of this player's positions. */
  positionRanks: { position: string; rank: number }[]
}

// One player's place in the Player Rankings page's default view (season,
// per-game, equal weights, no filters), so a profile shows the same rank/Z
// that page shows. Computed from the players list the caller already has.
export function getPlayerRankSummary(players: Player[], playerId: number, categories: RankingCategory[] = DEFAULT_CATEGORIES,
                                     reverseCategories: Set<RankingCategory> = EMPTY_REVERSE): PlayerRankSummary | null {
  const available = partitionByDataAvailability(players).available
  const target = available.find(p => p.player_id === playerId)
  if (!target || target.stats.gp <= 0) return null

  const weights = Object.fromEntries(categories.map(c => [c, 1])) as Record<RankingCategory, number>
  const config: RankingsConfig = { calcMode: 'per_game', minGp: 0, minMin: 0, position: null, weights }
  const ranked = computePlayerRankings(available, config, categories, reverseCategories)
  if (ranked.length === 0) return null

  const idx = ranked.findIndex(r => r.player.player_id === playerId)
  if (idx >= 0) {
    const positionRanks = target.positions.map(position => ({
      position,
      rank: ranked.slice(0, idx + 1).filter(r => r.player.positions.includes(position)).length,
    }))
    return { rank: idx + 1, poolSize: ranked.length, totalZ: ranked[idx].totalZ, zScores: ranked[idx].zScores, positionRanks }
  }

  const pool = ranked.map(r => r.player)
  const zScores = categoryZAgainstPool(target, pool, 'per_game', categories, reverseCategories)
  const totalZ = categories.reduce((sum, cat) => sum + zScores[cat] * weights[cat], 0) / categories.length
  return { rank: null, poolSize: ranked.length, totalZ, zScores, positionRanks: [] }
}

export interface DataAvailabilityPartition {
  available: Player[]
  excluded: Player[]
}

export function partitionByDataAvailability(players: Player[]): DataAvailabilityPartition {
  const available: Player[] = []
  const excluded: Player[] = []
  for (const p of players) {
    if (p.has_data === false) excluded.push(p)
    else available.push(p)
  }
  return { available, excluded }
}

import type { Player } from '../types/api'

export type RankingCategory = 'fg_pct' | 'ft_pct' | 'three_pm' | 'reb' | 'ast' | 'stl' | 'blk' | 'pts'

export const CATEGORIES: RankingCategory[] = ['fg_pct', 'ft_pct', 'three_pm', 'reb', 'ast', 'stl', 'blk', 'pts']

export const CATEGORY_LABELS: Record<RankingCategory, string> = {
  fg_pct: 'FG%',
  ft_pct: 'FT%',
  three_pm: '3PM',
  reb: 'REB',
  ast: 'AST',
  stl: 'STL',
  blk: 'BLK',
  pts: 'PTS',
}

const COUNTING_CATS = new Set<RankingCategory>(['three_pm', 'reb', 'ast', 'stl', 'blk', 'pts'])

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

function getCatValue(player: Player, cat: RankingCategory, calcMode: 'totals' | 'per_game'): number {
  const s = player.stats
  const gp = Math.max(s.gp, 1)
  const raw: Record<RankingCategory, number> = {
    fg_pct: s.fg_percentage,
    ft_pct: s.ft_percentage,
    three_pm: s.three_pm,
    reb: s.reb,
    ast: s.ast,
    stl: s.stl,
    blk: s.blk,
    pts: s.pts,
  }
  return calcMode === 'per_game' && COUNTING_CATS.has(cat) ? raw[cat] / gp : raw[cat]
}

function pctImpactArray(pool: Player[], pctKey: 'fg_percentage' | 'ft_percentage', attemptKey: 'fga' | 'fta', calcMode: 'totals' | 'per_game'): number[] {
  const poolMean = pool.reduce((s, p) => s + p.stats[pctKey], 0) / pool.length
  return pool.map(p => {
    const gp = Math.max(p.stats.gp, 1)
    const attempts = calcMode === 'per_game' ? p.stats[attemptKey] / gp : p.stats[attemptKey]
    return (p.stats[pctKey] - poolMean) * attempts
  })
}

function zScoreArray(values: number[]): number[] {
  if (values.length === 0) return []
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
  const stdev = Math.sqrt(variance)
  return values.map(v => (stdev === 0 ? 0 : (v - mean) / stdev))
}

function totalZArray(pool: Player[], calcMode: 'totals' | 'per_game', weights: Record<RankingCategory, number>): number[] {
  const catZs = CATEGORIES.map(cat => {
    if (cat === 'fg_pct') return zScoreArray(pctImpactArray(pool, 'fg_percentage', 'fga', calcMode))
    if (cat === 'ft_pct') return zScoreArray(pctImpactArray(pool, 'ft_percentage', 'fta', calcMode))
    return zScoreArray(pool.map(p => getCatValue(p, cat, calcMode)))
  })
  return pool.map((_, i) => CATEGORIES.reduce((sum, cat, ci) => sum + catZs[ci][i] * weights[cat], 0) / CATEGORIES.length)
}

export function computePlayerRankings(players: Player[], config: RankingsConfig): RankedPlayer[] {
  const { calcMode, minGp, minMin, position, weights } = config

  const filtered = players.filter(p =>
    p.stats.gp >= minGp &&
    (p.stats.gp > 0 ? p.stats.minutes / p.stats.gp : 0) >= minMin &&
    (position === null || p.positions.includes(position))
  )

  if (filtered.length === 0) return []

  let referencePool: Player[]
  if (filtered.length >= 300) {
    const pass1Z = totalZArray(filtered, calcMode, weights)
    referencePool = filtered
      .map((p, i) => ({ p, z: pass1Z[i] }))
      .sort((a, b) => b.z - a.z)
      .slice(0, 300)
      .map(x => x.p)
  } else {
    referencePool = filtered
  }

  const catZs = CATEGORIES.map(cat => {
    if (cat === 'fg_pct') return zScoreArray(pctImpactArray(referencePool, 'fg_percentage', 'fga', calcMode))
    if (cat === 'ft_pct') return zScoreArray(pctImpactArray(referencePool, 'ft_percentage', 'fta', calcMode))
    return zScoreArray(referencePool.map(p => getCatValue(p, cat, calcMode)))
  })

  return referencePool
    .map((p, i) => {
      const zScores = Object.fromEntries(
        CATEGORIES.map((cat, ci) => [cat, catZs[ci][i]])
      ) as Record<RankingCategory, number>
      const totalZ = CATEGORIES.reduce((sum, cat) => sum + zScores[cat] * weights[cat], 0) / CATEGORIES.length
      return { player: p, zScores, totalZ }
    })
    .sort((a, b) => b.totalZ - a.totalZ)
}

export function getRawValue(player: Player, cat: RankingCategory, displayMode: 'totals' | 'per_game'): number {
  return getCatValue(player, cat, displayMode)
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

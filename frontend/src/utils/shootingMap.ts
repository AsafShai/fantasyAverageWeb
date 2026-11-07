import type { Player } from '../types/api'
import { computePlayerRankings, DEFAULT_CATEGORIES, type RankingCategory } from './playerRankings'

/*
 * Shooting Map: every top-200 fantasy player as FG% (or FT%) against volume,
 * colored by how many makes above/below the pool's average they add to the
 * category. Pure data here; the chart in components/shootingMap draws it.
 */

export type ShotMode = 'fg' | 'ft'
export type ShotUnit = 'pg' | 'tot'
export type ShotFilter = 'all' | 'pct' | 'vol' | 'both' | 'imp'

export const POOL_SIZE = 200
/** Games a player needs in the window; the page lets the viewer change it. */
export const DEFAULT_MIN_GP = 2
/** Per-game attempts a picked team's player outside the top 200 needs to be shown. */
export const EXTRA_MIN_FGA = 1
export const EXTRA_MIN_FTA = 0.5

export interface ShotRow {
  key: string
  player: Player
  name: string
  team: string
  g: number
  /** Makes and attempts, per game or season totals (unit). */
  m: number
  a: number
  pct: number
  /** Makes above the pool's average percentage on these attempts. */
  imp: number
  /** imp in pool standard deviations. */
  z: number
  rVol: number
  /** Percentage rank among pool players over the minimum attempts; null below it. */
  rPct: number | null
  rImp: number
  /** Overall fantasy rank (8-cat z-score); null past the ranked pool. */
  frank: number | null
  /** One of the top-200; false for a picked team's extra players. */
  inPool: boolean
}

export interface ShotData {
  rows: ShotRow[]
  avgPct: number
  avgAtt: number
  sd: number
  x0: number
  x1: number
  y0: number
  y1: number
  /** Pool players over the minimum attempts (who get a percentage rank). */
  nq: number
  minA: number
}

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
function rankIn(sortedDesc: number[], v: number): number {
  let lo = 0, hi = sortedDesc.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sortedDesc[mid] > v) lo = mid + 1
    else hi = mid
  }
  return lo + 1
}

/**
 * Rows for one mode/unit. Averages, spread and ranks always come from the
 * top-200 pool; `extra` players (a picked team's others) are measured against it.
 */
export function deriveShotData(pool: Player[], extra: Player[], frank: Map<string, number>, mode: ShotMode, unit: ShotUnit): ShotData {
  const fg = mode === 'fg'
  const toRow = (p: Player, inPool: boolean): ShotRow | null => {
    const g = p.stats.gp
    const div = unit === 'pg' ? Math.max(g, 1) : 1
    const m = (fg ? p.stats.fgm : p.stats.ftm) / div
    const a = (fg ? p.stats.fga : p.stats.fta) / div
    if (!(a > 0)) return null
    const key = playerKey(p)
    return { key, player: p, name: p.player_name, team: p.pro_team, g, m, a, pct: m / a, imp: 0, z: 0,
      rVol: 0, rPct: null, rImp: 0, frank: frank.get(key) ?? null, inPool }
  }
  const poolRows = pool.map(p => toRow(p, true)).filter((r): r is ShotRow => r !== null)
  // A team's deep bench (0-for-1 in garbage time) would stretch the axes and
  // top the "worst" list, so extras need a real sample of attempts per game.
  const extraMin = fg ? EXTRA_MIN_FGA : EXTRA_MIN_FTA
  const extraRows = extra
    .filter(p => (fg ? p.stats.fga : p.stats.fta) / Math.max(p.stats.gp, 1) >= extraMin)
    .map(p => toRow(p, false)).filter((r): r is ShotRow => r !== null)
  const rows = [...poolRows, ...extraRows]
  if (poolRows.length === 0) {
    return { rows: [], avgPct: 0, avgAtt: 0, sd: 1, x0: 0, x1: 1, y0: 0, y1: 1, nq: 0, minA: 0 }
  }

  // The pool's percentage from season makes/attempts, so switching units never
  // moves it (a per-game average would lean toward players with fewer games).
  let madeTot = 0, attTot = 0
  for (const d of poolRows) {
    madeTot += fg ? d.player.stats.fgm : d.player.stats.ftm
    attTot += fg ? d.player.stats.fga : d.player.stats.fta
  }
  const avgPct = madeTot / attTot
  const avgAtt = poolRows.reduce((s, d) => s + d.a, 0) / poolRows.length
  for (const d of rows) d.imp = d.m - avgPct * d.a
  const sd = Math.sqrt(poolRows.reduce((s, d) => s + d.imp * d.imp, 0) / poolRows.length) || 1
  for (const d of rows) d.z = d.imp / sd

  // Percentage ranks only count players with a real sample of attempts.
  const avgGames = poolRows.reduce((s, d) => s + d.g, 0) / poolRows.length
  const minA = (fg ? 5 : 1.5) * (unit === 'tot' ? avgGames : 1)
  const vols = poolRows.map(d => d.a).sort((x, y) => y - x)
  const imps = poolRows.map(d => d.imp).sort((x, y) => y - x)
  const qualified = poolRows.filter(d => d.a >= minA)
  const pcts = qualified.map(d => d.pct).sort((x, y) => y - x)
  for (const d of rows) {
    d.rVol = rankIn(vols, d.a)
    d.rImp = rankIn(imps, d.imp)
    d.rPct = d.a >= minA ? rankIn(pcts, d.pct) : null
  }

  let x0 = Infinity, x1 = -Infinity, yMax = 0
  for (const d of rows) {
    if (d.pct < x0) x0 = d.pct
    if (d.pct > x1) x1 = d.pct
    if (d.a > yMax) yMax = d.a
  }
  const xp = (x1 - x0) * 0.05 || 0.05
  return { rows, avgPct, avgAtt, sd, x0: x0 - xp, x1: x1 + xp, y0: 0, y1: yMax * 1.06, nq: qualified.length, minA }
}

/** A fantasy team id (0 = free agents / waivers), any rostered player, or everyone. */
export type FantasyScope = number | 'rostered' | null

/** Which players the map is about: an NBA team and/or a fantasy team (both optional). */
export interface ShotScope {
  nba: string | null
  fantasy: FantasyScope
}

export const ALL_PLAYERS: ShotScope = { nba: null, fantasy: null }

export const isScoped = (scope: ShotScope): boolean => scope.nba !== null || scope.fantasy !== null

export function inScope(p: Player, scope: ShotScope): boolean {
  if (scope.nba && p.pro_team !== scope.nba) return false
  if (scope.fantasy === 'rostered') return p.team_id !== 0
  if (scope.fantasy !== null) return p.team_id === scope.fantasy
  return true
}

export function passesFilter(d: ShotRow, data: ShotData, filter: ShotFilter, scope: ShotScope): boolean {
  if (!inScope(d.player, scope)) return false
  const hp = d.pct > data.avgPct, hv = d.a > data.avgAtt
  switch (filter) {
    case 'pct': return hp
    case 'vol': return hv
    case 'both': return hp && hv
    case 'imp': return d.imp > 0
    default: return true
  }
}

/** Best `n` among players who help, worst `n` among players who hurt. */
export function impactLists(rows: ShotRow[], n: number): { top: ShotRow[]; bottom: ShotRow[] } {
  const sorted = [...rows].sort((a, b) => b.imp - a.imp)
  const top = sorted.filter(d => d.imp > 0).slice(0, n)
  const bottom = sorted.filter(d => d.imp < 0).reverse().slice(0, n)
  return { top, bottom }
}

/** "+1.2" / "−0.4"; a value that rounds to zero shows as plain "0". */
export function signedImpact(v: number, unit: ShotUnit): string {
  const text = unit === 'tot' ? Math.round(Math.abs(v)).toString() : Math.abs(v).toFixed(1)
  if (Number(text) === 0) return '0'
  return (v > 0 ? '+' : '−') + text
}

export const shotLabels = (mode: ShotMode) =>
  mode === 'fg' ? { pct: 'FG%', att: 'FGA', made: 'FGM' } : { pct: 'FT%', att: 'FTA', made: 'FTM' }

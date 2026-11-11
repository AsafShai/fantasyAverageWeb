import type { Player } from '../types/api'
import { inScope, isScoped, playerKey, rankIn, type ShotPool, type ShotScope, type ShotUnit } from './shootingMap'

/*
 * Player Scatter Map: any two stats against each other, one dot per player.
 * The pair on the axes picks how a dot is colored (ruleOf):
 *  - a shooting pair (FG% + FGA, FT% + FTA, TS% + PTS) keeps the shooting
 *    impact: makes above the pool's percentage on the player's own attempts;
 *  - a counting stat against minutes is colored by its per-minute rate;
 *  - any other pair by the average of the two stats' z-scores.
 * Pure data here: each chart is rows (x, y, z) plus a "meta" with its own
 * words, axis formats and guide curves. components/shootingMap draws it.
 */

export type StatId = 'PTS' | 'REB' | 'AST' | 'STL' | 'BLK' | '3PM' | 'FG%' | 'FT%' | 'FG Imp' | 'FT Imp' | 'FGA' | 'FTA' | 'TS%' | 'MIN'
export type ChartMode = 'shooting' | 'minute' | 'custom'
export type ScatterFilter = 'all' | 'x' | 'y' | 'both' | 'good'

export const DEFAULT_MIN_MIN = 10
/** Per-game attempts a picked team's player outside the top 200 needs to be shown. */
export const EXTRA_MIN_FGA = 1
export const EXTRA_MIN_FTA = 0.5

export interface StatDef {
  name: string
  /** count: a per-game number; pct: makes / attempts; impact: makes above the pool's percentage, per game. */
  kind: 'count' | 'pct' | 'impact'
  /** How much a player plays or shoots. It can be an axis, but more of it is not better, so it never colors a dot. */
  volume: boolean
  /** Period total of a counting stat. */
  v(p: Player): number
  /** Period makes and attempts behind a percentage or an impact. */
  m(p: Player): number
  a(p: Player): number
  att: string
  /** Attempts per game a player outside the pool needs. */
  minAtt: number
}

const none = () => 0
const count = (name: string, v: (p: Player) => number, volume = false): StatDef =>
  ({ name, kind: 'count', volume, v, m: none, a: none, att: '', minAtt: 0 })
const shot = (name: string, kind: 'pct' | 'impact', m: (p: Player) => number, a: (p: Player) => number, att: string, minAtt: number): StatDef =>
  ({ name, kind, volume: false, v: none, m, a, att, minAtt })
const tsAttempts = (p: Player) => p.stats.fga + 0.44 * p.stats.fta

/** Everything an axis can show: the league's counting categories and percentages, plus impact, volume and TS%. */
export const STATS: Record<StatId, StatDef> = {
  PTS: count('Points', p => p.stats.pts),
  REB: count('Rebounds', p => p.stats.reb),
  AST: count('Assists', p => p.stats.ast),
  STL: count('Steals', p => p.stats.stl),
  BLK: count('Blocks', p => p.stats.blk),
  '3PM': count('Threes made', p => p.stats.three_pm),
  'FG%': shot('Field goal %', 'pct', p => p.stats.fgm, p => p.stats.fga, 'FGA', EXTRA_MIN_FGA),
  'FT%': shot('Free throw %', 'pct', p => p.stats.ftm, p => p.stats.fta, 'FTA', EXTRA_MIN_FTA),
  'FG Imp': shot('FG impact: field goals made above average on his attempts', 'impact', p => p.stats.fgm, p => p.stats.fga, 'FGA', EXTRA_MIN_FGA),
  'FT Imp': shot('FT impact: free throws made above average on his attempts', 'impact', p => p.stats.ftm, p => p.stats.fta, 'FTA', EXTRA_MIN_FTA),
  FGA: count('Field goal attempts', p => p.stats.fga, true),
  FTA: count('Free throw attempts', p => p.stats.fta, true),
  'TS%': shot('True shooting %', 'pct', p => p.stats.pts / 2, tsAttempts, 'TSA', 1),
  MIN: count('Minutes', p => p.stats.minutes, true),
}
export const AXIS_ORDER: StatId[] = ['PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'FG%', 'FT%', 'FG Imp', 'FT Imp', 'FGA', 'FTA', 'TS%', 'MIN']
export const isStatId = (v: unknown): v is StatId => typeof v === 'string' && v in STATS

/** A shooting pair: the percentage on one axis, its volume on the other. */
export interface ShotChart {
  px: StatId
  py: StatId
  pct: string
  att: string
  made: string
  m(p: Player): number
  a(p: Player): number
  /** Turns "makes" into the shown unit (TS%: a make is two points). */
  scale: number
  /** Attempts per game a percentage rank needs. */
  minRank: number
  /** Attempts per game a picked team's player outside the top 200 needs. */
  extraMin: number
  /** The volume axis shows points, not attempts (TS%). */
  points: boolean
}

export const SHOTS: ShotChart[] = [
  { px: 'FG%', py: 'FGA', pct: 'FG%', att: 'FGA', made: 'FGM', m: p => p.stats.fgm, a: p => p.stats.fga, scale: 1, minRank: 5, extraMin: EXTRA_MIN_FGA, points: false },
  { px: 'FT%', py: 'FTA', pct: 'FT%', att: 'FTA', made: 'FTM', m: p => p.stats.ftm, a: p => p.stats.fta, scale: 1, minRank: 1.5, extraMin: EXTRA_MIN_FTA, points: false },
  { px: 'TS%', py: 'PTS', pct: 'TS%', att: 'TSA', made: 'PTS', m: p => p.stats.pts / 2, a: tsAttempts, scale: 2, minRank: 5, extraMin: 1, points: true },
]

export interface ChartOption { label: string; x: StatId; y: StatId }
/** The three analyses and the charts each one offers. An option only fills the two axes. */
export const MODES: { id: ChartMode; label: string; options: ChartOption[] }[] = [
  { id: 'shooting', label: 'Shooting', options: [
    { label: 'FG% × FGA', x: 'FG%', y: 'FGA' }, { label: 'FT% × FTA', x: 'FT%', y: 'FTA' }, { label: 'TS% × Points', x: 'TS%', y: 'PTS' },
  ] },
  { id: 'minute', label: 'Per minute', options: [
    { label: 'Points', x: 'MIN', y: 'PTS' }, { label: 'Rebounds', x: 'MIN', y: 'REB' }, { label: 'Assists', x: 'MIN', y: 'AST' },
    { label: 'Steals', x: 'MIN', y: 'STL' }, { label: 'Blocks', x: 'MIN', y: 'BLK' }, { label: 'Threes', x: 'MIN', y: '3PM' },
  ] },
  { id: 'custom', label: 'Custom', options: [
    { label: 'Steals × Blocks', x: 'STL', y: 'BLK' }, { label: 'Points × Assists', x: 'PTS', y: 'AST' }, { label: 'Rebounds × Blocks', x: 'REB', y: 'BLK' },
  ] },
]

export type ChartRule =
  | { kind: 'shot'; chart: ShotChart; flip: boolean }
  | { kind: 'rate'; stat: StatId; flip: boolean }
  | { kind: 'z'; flip: false }

/** The color rule of a pair of axes, in either order. */
export function ruleOf(cx: StatId, cy: StatId): ChartRule {
  for (const chart of SHOTS) {
    if (cx === chart.px && cy === chart.py) return { kind: 'shot', chart, flip: false }
    if (cx === chart.py && cy === chart.px) return { kind: 'shot', chart, flip: true }
  }
  const counting = (id: StatId) => STATS[id].kind === 'count' && !STATS[id].volume
  if (cx === 'MIN' && counting(cy)) return { kind: 'rate', stat: cy, flip: false }
  if (cy === 'MIN' && counting(cx)) return { kind: 'rate', stat: cx, flip: true }
  return { kind: 'z', flip: false }
}

export interface ScatterRow {
  key: string
  player: Player
  name: string
  team: string
  g: number
  x: number
  y: number
  /** What the chart draws: x and y, exchanged when a known pair is shown the other way round. */
  px: number
  py: number
  /** The chart's own score (makes above average, per-36 rate, average z-score) and its z-score, which colors the dot. */
  imp: number
  z: number
  /** Overall fantasy rank (z-score ranking); null past the ranked pool. */
  frank: number | null
  /** One of the players the averages come from; false for a picked team's extra players. */
  inPool: boolean
  /** Shooting charts: makes and attempts in the shown unit. */
  m: number
  a: number
  /** Shooting charts: percentage rank among pool players over the minimum attempts; null below it. */
  rPct: number | null
  /** Ranks of the x and y values and of the score, among the pool. */
  rX: number
  rY: number
  rImp: number
  /** Custom charts: each axis' z-score. */
  zx: number
  zy: number
}

/** One axis of a custom chart: the pool's average, and the spread its z-score uses. */
interface AxisFit { avg: number; mean: number; sd: number }

export interface ScatterData {
  rows: ScatterRow[]
  avgX: number
  avgY: number
  sd: number
  /** Rates: the pool's per-36 average. */
  mean: number
  x0: number
  x1: number
  y0: number
  y1: number
  /** Pool players a rank is out of. */
  nq: number
  ax: AxisFit
  ay: AxisFit
}

const NO_FIT: AxisFit = { avg: 0, mean: 0, sd: 1 }
const EMPTY: ScatterData = { rows: [], avgX: 0, avgY: 0, sd: 1, mean: 0, x0: 0, x1: 1, y0: 0, y1: 1, nq: 0, ax: NO_FIT, ay: NO_FIT }

function newRow(p: Player, frank: Map<string, number>, inPool: boolean, x: number, y: number): ScatterRow {
  const key = playerKey(p)
  return { key, player: p, name: p.player_name, team: p.pro_team, g: p.stats.gp, x, y, px: x, py: y, imp: 0, z: 0,
    frank: frank.get(key) ?? null, inPool, m: 0, a: 0, rPct: null, rX: 0, rY: 0, rImp: 0, zx: 0, zy: 0 }
}

const games = (p: Player) => Math.max(p.stats.gp, 1)
const desc = (values: number[]) => values.sort((a, b) => b - a)

/**
 * Shooting: rows for one chart/unit. Averages, spread and ranks always come
 * from the top-200 pool; `extra` players (a picked team's others) are measured against it.
 */
export function deriveShots(pool: Player[], extra: Player[], frank: Map<string, number>, ch: ShotChart, unit: ShotUnit): ScatterData {
  const toRow = (p: Player, inPool: boolean): ScatterRow | null => {
    const div = unit === 'pg' ? games(p) : 1
    const m = ch.m(p) / div, a = ch.a(p) / div
    if (!(a > 0)) return null
    return { ...newRow(p, frank, inPool, m / a, ch.points ? p.stats.pts / div : a), m, a }
  }
  const present = (r: ScatterRow | null): r is ScatterRow => r !== null
  const poolRows = pool.map(p => toRow(p, true)).filter(present)
  // A team's deep bench (0-for-1 in garbage time) would stretch the axes and
  // top the "worst" list, so extras need a real sample of attempts per game.
  const extraRows = extra.filter(p => ch.a(p) / games(p) >= ch.extraMin).map(p => toRow(p, false)).filter(present)
  const rows = [...poolRows, ...extraRows]
  if (poolRows.length === 0) return EMPTY

  // The pool's percentage from period makes/attempts, so switching units never
  // moves it (a per-game average would lean toward players with fewer games).
  let madeTot = 0, attTot = 0
  for (const d of poolRows) { madeTot += ch.m(d.player); attTot += ch.a(d.player) }
  const avgX = madeTot / attTot
  const avgY = poolRows.reduce((s, d) => s + d.y, 0) / poolRows.length
  for (const d of rows) d.imp = d.m - avgX * d.a
  const sd = Math.sqrt(poolRows.reduce((s, d) => s + d.imp * d.imp, 0) / poolRows.length) || 1
  for (const d of rows) d.z = d.imp / sd

  // Percentage ranks only count players with a real sample of attempts.
  const avgGames = poolRows.reduce((s, d) => s + d.g, 0) / poolRows.length
  const minA = ch.minRank * (unit === 'tot' ? avgGames : 1)
  const vols = desc(poolRows.map(d => d.y)), imps = desc(poolRows.map(d => d.imp))
  const qualified = poolRows.filter(d => d.a >= minA)
  const pcts = desc(qualified.map(d => d.x))
  for (const d of rows) {
    d.rY = rankIn(vols, d.y)
    d.rImp = rankIn(imps, d.imp)
    d.rPct = d.a >= minA ? rankIn(pcts, d.x) : null
  }

  let x0 = Infinity, x1 = -Infinity, yMax = 0
  for (const d of rows) {
    if (d.x < x0) x0 = d.x
    if (d.x > x1) x1 = d.x
    if (d.y > yMax) yMax = d.y
  }
  const xp = (x1 - x0) * 0.05 || 0.05
  return { ...EMPTY, rows, avgX, avgY, sd, x0: x0 - xp, x1: x1 + xp, y0: 0, y1: yMax * 1.06, nq: qualified.length }
}

/**
 * Rates: one counting stat (y, per game) against minutes per game (x), for
 * every player handed in (the page applies the games and minutes floors).
 * The color is the stat per 36 minutes against those players.
 */
export function deriveRates(players: Player[], frank: Map<string, number>, S: StatDef): ScatterData {
  const rows = players.filter(p => p.stats.minutes > 0)
    .map(p => newRow(p, frank, true, p.stats.minutes / games(p), S.v(p) / games(p)))
  if (rows.length === 0) return EMPTY
  let statTot = 0, minTot = 0
  for (const d of rows) { statTot += S.v(d.player); minTot += d.player.stats.minutes }
  const mean = statTot / minTot * 36
  for (const d of rows) d.imp = S.v(d.player) / d.player.stats.minutes * 36
  const sd = Math.sqrt(rows.reduce((s, d) => s + (d.imp - mean) * (d.imp - mean), 0) / rows.length) || 1
  for (const d of rows) d.z = (d.imp - mean) / sd
  const ys = desc(rows.map(d => d.y)), imps = desc(rows.map(d => d.imp))
  for (const d of rows) { d.rY = rankIn(ys, d.y); d.rImp = rankIn(imps, d.imp) }

  let x0 = Infinity, x1 = -Infinity, yMax = 0
  for (const d of rows) {
    if (d.x < x0) x0 = d.x
    if (d.x > x1) x1 = d.x
    if (d.y > yMax) yMax = d.y
  }
  const xp = (x1 - x0) * 0.05 || 1
  // A little room under zero, so the dots at zero clear the frame.
  return { ...EMPTY, rows, avgX: rows.reduce((s, d) => s + d.x, 0) / rows.length, avgY: rows.reduce((s, d) => s + d.y, 0) / rows.length,
    sd, mean, x0: Math.max(0, x0 - xp), x1: x1 + xp, y0: -yMax * 0.04, y1: yMax * 1.06, nq: rows.length }
}

/**
 * Custom: two stats (per game) against each other for the top-200 pool. Each
 * stat becomes a z-score against the pool; the color is the average of the
 * two. A percentage is scored as in Player Rankings: makes above the pool's
 * percentage on the player's own attempts, so volume counts.
 */
export function deriveCustom(pool: Player[], extra: Player[], frank: Map<string, number>, SX: StatDef, SY: StatDef): ScatterData {
  // The pool's percentage from period makes and attempts, as on the shooting charts.
  const poolPct = (S: StatDef) => {
    let mt = 0, at = 0
    for (const p of pool) { mt += S.m(p); at += S.a(p) }
    return at > 0 ? mt / at : 0
  }
  const pctX = SX.kind === 'impact' ? poolPct(SX) : 0, pctY = SY.kind === 'impact' ? poolPct(SY) : 0
  const val = (S: StatDef, p: Player, pct: number): number | null => {
    if (S.kind === 'pct') return S.a(p) > 0 ? S.m(p) / S.a(p) : null
    if (S.kind === 'impact') return (S.m(p) - pct * S.a(p)) / games(p)
    return S.v(p) / games(p)
  }
  const toRow = (p: Player, inPool: boolean): ScatterRow | null => {
    const x = val(SX, p, pctX), y = val(SY, p, pctY)
    return x === null || y === null ? null : newRow(p, frank, inPool, x, y)
  }
  const present = (r: ScatterRow | null): r is ScatterRow => r !== null
  // A team's deep bench (1-for-1 in garbage time) would stretch a percentage axis, so extras need a real sample of attempts.
  const sample = (S: StatDef, p: Player) => S.kind === 'count' || S.a(p) / games(p) >= S.minAtt
  const poolRows = pool.map(p => toRow(p, true)).filter(present)
  const extraRows = extra.filter(p => sample(SX, p) && sample(SY, p)).map(p => toRow(p, false)).filter(present)
  const rows = [...poolRows, ...extraRows]
  if (poolRows.length === 0) return EMPTY

  const axis = (S: StatDef, f: 'x' | 'y') => {
    let avg: number, score: (d: ScatterRow) => number
    if (S.kind === 'pct') {
      let mt = 0, at = 0
      for (const d of poolRows) { mt += S.m(d.player); at += S.a(d.player) }
      const pct = avg = mt / at
      score = d => (S.m(d.player) - pct * S.a(d.player)) / games(d.player)
    } else {
      avg = poolRows.reduce((s, d) => s + d[f], 0) / poolRows.length
      score = d => d[f]
    }
    const vals = poolRows.map(score), mean = vals.reduce((s, v) => s + v, 0) / vals.length
    const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) * (v - mean), 0) / vals.length) || 1
    let lo = Infinity, hi = -Infinity
    for (const d of rows) {
      if (d[f] < lo) lo = d[f]
      if (d[f] > hi) hi = d[f]
    }
    const pad = (hi - lo) * 0.05 || 0.05
    // A counting stat keeps a little room under zero, so the dots at zero clear the frame.
    const framed = S.kind !== 'count'
    return { fit: { avg, mean, sd }, z: (d: ScatterRow) => (score(d) - mean) / sd, lo: framed ? lo - pad : -hi * 0.04, hi: framed ? hi + pad : hi * 1.06,
      sorted: desc(poolRows.map(d => d[f])) }
  }
  const ax = axis(SX, 'x'), ay = axis(SY, 'y')
  // A volume stat (attempts, minutes) is drawn but not scored: the color is the
  // other stat's z-score, or nothing when both are volume.
  const wx = SX.volume ? 0 : 1, wy = SY.volume ? 0 : 1
  for (const d of rows) {
    d.zx = ax.z(d)
    d.zy = ay.z(d)
    d.imp = d.z = (wx * d.zx + wy * d.zy) / (wx + wy || 1)
  }
  const imps = desc(poolRows.map(d => d.imp))
  for (const d of rows) {
    d.rX = rankIn(ax.sorted, d.x)
    d.rY = rankIn(ay.sorted, d.y)
    d.rImp = rankIn(imps, d.imp)
  }
  return { ...EMPTY, rows, avgX: ax.fit.avg, avgY: ay.fit.avg, x0: ax.lo, x1: ax.hi, y0: ay.lo, y1: ay.hi, nq: poolRows.length, ax: ax.fit, ay: ay.fit }
}

/** What the chart draws against: averages and frame, already exchanged for a flipped pair. */
export interface ScatterView { avgX: number; avgY: number; x0: number; x1: number; y0: number; y1: number }

/** The viewer's own floors for the drawn X and Y values (in the axis' own unit). */
export interface ScatterThresholds { minX: number | null; minY: number | null }
export const NO_THRESHOLDS: ScatterThresholds = { minX: null, minY: null }

export function passesFilter(d: ScatterRow, view: ScatterView, filter: ScatterFilter, scope: ShotScope,
                             thresholds: ScatterThresholds = NO_THRESHOLDS): boolean {
  if (!inScope(d.player, scope)) return false
  if (thresholds.minX !== null && d.px < thresholds.minX) return false
  if (thresholds.minY !== null && d.py < thresholds.minY) return false
  const hx = d.px > view.avgX, hy = d.py > view.avgY
  switch (filter) {
    case 'x': return hx
    case 'y': return hy
    case 'both': return hx && hy
    case 'good': return d.z > 0
    default: return true
  }
}

/** Best `n` among players above the pool, worst `n` among players below it. */
export function scoreLists(rows: ScatterRow[], n: number): { top: ScatterRow[]; bottom: ScatterRow[] } {
  const sorted = [...rows].sort((a, b) => b.z - a.z)
  return { top: sorted.filter(d => d.z > 0).slice(0, n), bottom: sorted.filter(d => d.z < 0).reverse().slice(0, n) }
}

export const fmtPct = (v: number) => (v * 100).toFixed(1) + '%'
/** "+1.2" / "−0.4"; a value that rounds to zero shows as plain "0". */
export function signed(v: number, digits: number): string {
  const text = Math.abs(v).toFixed(digits)
  if (Number(text) === 0) return '0'
  return (v > 0 ? '+' : '−') + text
}
// Tick labels carry as many decimals as the step between them needs, so a deep zoom never repeats a label.
const tickNum = (v: number, step: number) => v.toFixed(step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3).replace('-', '−')
const tickPct = (v: number, step: number) => (v * 100).toFixed(step >= 0.01 ? 0 : step >= 0.001 ? 1 : 2) + '%'

/** The visible part of the chart, in axis values. */
export interface Bounds { vx0: number; vx1: number; vy0: number; vy1: number }
/** A dashed guide: every player on it has the same score. */
export interface Curve {
  pts: [number, number][]
  tone: 'hot' | 'cold' | 'muted'
  opacity: number
  text: string
  /** Where its label sits, or null for none. */
  at: [number, number] | null
  /** The label goes right of that point (else left). */
  right: boolean
}
export interface TipRow { k: string; v: string; good?: boolean }
export interface ThresholdDef { label: string; suffix: string; scale: number; step: number }

export interface ChartMeta {
  xTitle: string
  yTitle: string
  tickX(v: number, step: number): string
  tickY(v: number, step: number): string
  minStepX: number
  minStepY: number
  /** The axis has values under zero (an impact); otherwise the room left under zero gets no tick. */
  signedX: boolean
  signedY: boolean
  avgXText: string
  avgYText: string
  /** Corner names: top right, top left, bottom right, bottom left. */
  quads: [string, string, string, string]
  curves(b: Bounds): Curve[]
  /** The short line under a labeled dot. */
  ann(d: ScatterRow): string
  /** The lines under a pinned dot: its two values with their ranks. */
  pin(d: ScatterRow): string[]
  tipRows(d: ScatterRow): TipRow[]
  /** The two values with their ranks, as the side lists show them. */
  values(d: ScatterRow): string
  /** The score the side lists show. */
  impact(d: ScatterRow): string
  words: { low: string; high: string; chipX: string; chipY: string; chipGood: string | null; best: string; worst: string }
  th1: ThresholdDef
  th2: ThresholdDef
  /** Custom: the chart draws equal-score lines. */
  lines: boolean
}

const rank = (d: ScatterRow, r: number | null) => (d.inPool && r ? ` (#${r})` : '')

/** The words, formats and guide curves of a shooting chart. */
export function shotMeta(data: ScatterData, ch: ShotChart, unit: ShotUnit): ChartMeta {
  const fmtN = (v: number) => (unit === 'tot' ? Math.round(v).toString() : v.toFixed(1))
  const yShort = ch.points ? 'PTS' : ch.att, vol = ch.points ? 'scoring' : 'volume'
  // TS% is not a league category, so its chart talks about scoring efficiency, never about helping a category.
  const scouting = ch.points
  const impact = (d: ScatterRow) => signed(d.imp * ch.scale, unit === 'tot' ? 0 : 1)
  const plain = (d: ScatterRow) => fmtPct(d.x) + (ch.points ? ' with ' : ' on ') + fmtN(d.y) + ' ' + yShort
  // equal-impact curves: pct = avg + c / attempts; against points (y = 2 x makes) the same curve is pct = avg / (1 - 2c / points)
  const pctAt = (a: number, cc: number) => (ch.points ? (a > 2 * cc ? data.avgX / (1 - 2 * cc / a) : Infinity) : data.avgX + cc / a)
  const values = (d: ScatterRow) => `${fmtPct(d.x)} ${ch.pct}${rank(d, d.rPct)} · ${fmtN(d.y)} ${yShort}${rank(d, d.rY)}`
  return {
    xTitle: ch.pct + '  →', yTitle: (unit === 'tot' ? 'TOTAL ' : '') + yShort + (unit === 'pg' ? ' / GAME' : '') + '  →',
    tickX: tickPct, tickY: tickNum, minStepX: 0, minStepY: unit === 'tot' ? 1 : 0, signedX: false, signedY: false,
    avgXText: 'AVG ' + fmtPct(data.avgX), avgYText: 'AVG ' + fmtN(data.avgY) + ' ' + yShort,
    quads: [`High ${vol}, high %`, `High ${vol}, low %`, `Low ${vol}, high %`, `Low ${vol}, low %`],
    curves: b => {
      const out: Curve[] = []
      ;[1, 2].map(m => m * data.sd).forEach((c, li) => [c, -c].forEach(cc => {
        const pts: [number, number][] = []
        const aMin = Math.max(0.2, b.vy0), aMax = b.vy1
        for (let i = 0; i <= 120; i++) {
          const a = aMin + (aMax - aMin) * Math.pow(i / 120, 1.6), p = pctAt(a, cc)
          if (p < b.vx0 - 0.2 || p > b.vx1 + 0.2) continue
          pts.push([p, a])
        }
        const aL = b.vy0 + (b.vy1 - b.vy0) * 0.9
        out.push({ pts, tone: cc > 0 ? 'hot' : 'cold', opacity: li ? 0.35 : 0.5, text: (cc > 0 ? '+' : '−') + fmtN(Math.abs(cc) * ch.scale),
          at: aL > 0.2 ? [pctAt(aL, cc), aL] : null, right: cc > 0 })
      }))
      return out
    },
    ann: d => {
      // Ranks are among the top 200; a team's other players get none.
      if (!d.inPool) return plain(d)
      const parts: string[] = []
      if (d.rPct && d.rPct <= 10) parts.push(`#${d.rPct} ${ch.pct}`)
      else if (d.rPct && d.rPct > data.nq - 10) parts.push(`#${d.rPct}/${data.nq} ${ch.pct}`)
      if (d.rY <= 10) parts.push(`#${d.rY} ${yShort}`)
      return parts.length ? parts.join(' · ') : plain(d)
    },
    pin: d => [values(d)],
    tipRows: d => {
      const rows: TipRow[] = [
        { k: `${ch.made}/${ch.att}`, v: `${fmtN(d.m * ch.scale)} / ${fmtN(d.a)}` },
        { k: ch.pct, v: fmtPct(d.x) + rank(d, d.rPct) },
      ]
      if (d.inPool) rows.push({ k: `${yShort} rank`, v: `#${d.rY}` })
      rows.push({ k: scouting ? 'Points vs. average' : 'Impact', v: impact(d) + rank(d, d.rImp), good: d.z >= 0 })
      return rows
    },
    values, impact,
    words: scouting
      ? { low: 'Below average', high: 'Above average', chipX: `Above-avg ${ch.pct}`, chipY: `Above-avg ${yShort}`, chipGood: 'Efficient scorers',
        best: 'Most efficient scorers', worst: 'Least efficient scorers' }
      : { low: 'Hurts', high: 'Helps', chipX: `Above-avg ${ch.pct}`, chipY: `Above-avg ${yShort}`, chipGood: `Helps ${ch.pct}`,
        best: `Best for ${ch.pct}`, worst: `Worst for ${ch.pct}` },
    th1: { label: ch.pct, suffix: '%', scale: 0.01, step: 1 },
    th2: { label: yShort, suffix: unit === 'pg' ? '/g' : '', scale: 1, step: unit === 'tot' ? 5 : 0.5 },
    lines: false,
  }
}

/** The words, formats and guide lines of a rates chart. */
export function rateMeta(data: ScatterData, stat: StatId): ChartMeta {
  const plain = (d: ScatterRow) => `${d.y.toFixed(1)} ${stat} in ${d.x.toFixed(1)} MIN`
  const values = (d: ScatterRow) => `${d.x.toFixed(1)} MIN · ${d.y.toFixed(1)} ${stat} (#${d.rY})`
  return {
    xTitle: 'MIN / GAME  →', yTitle: stat + ' / GAME  →',
    tickX: tickNum, tickY: tickNum, minStepX: 0, minStepY: 0, signedX: false, signedY: false,
    avgXText: 'AVG ' + data.avgX.toFixed(1) + ' MIN', avgYText: 'AVG ' + data.avgY.toFixed(1) + ' ' + stat,
    quads: [`Many minutes, high ${stat}`, `Few minutes, high ${stat}`, `Many minutes, low ${stat}`, `Few minutes, low ${stat}`],
    // equal-rate lines: every player on one line produces the same per minute
    curves: b => {
      const out: Curve[] = []
      for (const k of [-2, -1, 0, 1, 2]) {
        const r36 = data.mean + k * data.sd
        if (r36 <= 0) continue
        const r = r36 / 36
        const xL = Math.min(b.vx0 + (b.vx1 - b.vx0) * 0.93, (b.vy0 + (b.vy1 - b.vy0) * 0.94) / r)
        out.push({ pts: [[b.vx0, r * b.vx0], [b.vx1, r * b.vx1]], tone: k > 0 ? 'hot' : k < 0 ? 'cold' : 'muted', opacity: Math.abs(k) === 2 ? 0.35 : 0.55,
          text: (k === 0 ? 'avg ' : '') + r36.toFixed(1) + ' /36', at: xL > b.vx0 ? [xL, r * xL] : null, right: false })
      }
      return out
    },
    ann: d => {
      if (d.rImp <= 10) return `#${d.rImp} ${stat} per minute`
      if (d.rImp > data.nq - 10) return `#${d.rImp}/${data.nq} ${stat} per minute`
      return plain(d)
    },
    pin: d => [values(d)],
    tipRows: d => [
      { k: 'MIN / game', v: d.x.toFixed(1) },
      { k: `${stat} / game`, v: `${d.y.toFixed(1)} (#${d.rY})` },
      { k: `${stat} per 36`, v: `${d.imp.toFixed(1)} (#${d.rImp})`, good: d.z >= 0 },
    ],
    values,
    impact: d => d.imp.toFixed(1) + ' /36',
    words: { low: 'Less per minute', high: 'More per minute', chipX: 'Above-avg minutes', chipY: `Above-avg ${stat}`, chipGood: 'Above-avg per minute',
      best: `Best ${stat} per minute`, worst: `Lowest ${stat} per minute` },
    th1: { label: 'MIN', suffix: '/g', scale: 1, step: 1 }, th2: { label: stat, suffix: '/g', scale: 1, step: 0.5 },
    lines: false,
  }
}

/** The words, formats and guide lines of a custom chart (stat ix on the X axis, iy on the Y axis). */
export function customMeta(data: ScatterData, ix: StatId, iy: StatId): ChartMeta {
  const SX = STATS[ix], SY = STATS[iy]
  const num = (S: StatDef, v: number) => (S.kind === 'pct' ? fmtPct(v) : S.kind === 'impact' ? signed(v, 1) : v.toFixed(1))
  const val = (S: StatDef, id: StatId, v: number) => num(S, v) + ' ' + (S.kind === 'pct' ? id.slice(0, -1) : id)
  const tick = (S: StatDef) => (S.kind === 'pct' ? tickPct : tickNum)
  const title = (S: StatDef, id: StatId) => (S.kind === 'pct' ? id : id + ' / GAME') + '  →'
  const scored = [SX.volume ? null : ix, SY.volume ? null : iy].filter((id): id is StatId => id !== null), two = scored.length === 2
  const both = scored.join(' + '), lines = two && SX.kind !== 'pct' && SY.kind !== 'pct'
  const plain = (d: ScatterRow) => val(SX, ix, d.x) + ' · ' + val(SY, iy, d.y)
  // The percentage and attempts per game behind an impact value.
  const raw = (S: StatDef, d: ScatterRow) => {
    const a = S.a(d.player)
    return `${a > 0 ? fmtPct(S.m(d.player) / a) : '–'} on ${(a / games(d.player)).toFixed(1)} ${S.att}`
  }
  const pinLine = (S: StatDef, id: StatId, v: number, r: number, d: ScatterRow) => val(S, id, v) + rank(d, r) + (S.kind === 'impact' ? ' · ' + raw(S, d) : '')
  const values = (d: ScatterRow) => val(SX, ix, d.x) + rank(d, d.rX) + ' · ' + val(SY, iy, d.y) + rank(d, d.rY)
  const th = (S: StatDef, id: StatId): ThresholdDef => (S.kind === 'pct' ? { label: id, suffix: '%', scale: 0.01, step: 1 } : { label: id, suffix: '/g', scale: 1, step: 0.5 })
  return {
    xTitle: title(SX, ix), yTitle: title(SY, iy), tickX: tick(SX), tickY: tick(SY), minStepX: 0, minStepY: 0,
    signedX: SX.kind === 'impact', signedY: SY.kind === 'impact',
    avgXText: 'AVG ' + val(SX, ix, data.avgX), avgYText: 'AVG ' + val(SY, iy, data.avgY),
    quads: [`High ${ix}, high ${iy}`, `Low ${ix}, high ${iy}`, `High ${ix}, low ${iy}`, `Low ${ix}, low ${iy}`],
    // equal-score lines: every player on one line has the same average of the two z-scores
    curves: b => {
      if (!lines) return []
      const out: Curve[] = []
      for (const c of [-0.5, 0, 0.5, 1, 2]) {
        const yAt = (x: number) => data.ay.mean + data.ay.sd * (2 * c - (x - data.ax.mean) / data.ax.sd)
        const xAt = (y: number) => data.ax.mean + data.ax.sd * (2 * c - (y - data.ay.mean) / data.ay.sd)
        const xL = Math.min(b.vx0 + (b.vx1 - b.vx0) * 0.95, xAt(b.vy0 + (b.vy1 - b.vy0) * 0.05))
        out.push({ pts: [[b.vx0, yAt(b.vx0)], [b.vx1, yAt(b.vx1)]], tone: c > 0 ? 'hot' : c < 0 ? 'cold' : 'muted', opacity: c === 2 ? 0.35 : 0.55,
          text: c === 0 ? 'avg' : (c > 0 ? '+' : '−') + Math.abs(c) + ' z', at: xL > b.vx0 ? [xL, yAt(xL)] : null, right: false })
      }
      return out
    },
    ann: d => {
      const parts: string[] = []
      if (d.inPool && d.rX <= 10) parts.push(`#${d.rX} ${ix}`)
      if (d.inPool && d.rY <= 10) parts.push(`#${d.rY} ${iy}`)
      return parts.length ? parts.join(' · ') : plain(d)
    },
    // An impact also spells out the percentage and attempts behind it, so each stat gets its own line.
    pin: d => (SX.kind === 'impact' || SY.kind === 'impact' ? [pinLine(SX, ix, d.x, d.rX, d), pinLine(SY, iy, d.y, d.rY, d)] : [values(d)]),
    tipRows: d => {
      const rows: TipRow[] = [
        { k: SX.kind === 'pct' ? ix : ix + ' / game', v: num(SX, d.x) + ' · z ' + signed(d.zx, 1) },
        { k: SY.kind === 'pct' ? iy : iy + ' / game', v: num(SY, d.y) + ' · z ' + signed(d.zy, 1) },
      ]
      if (SX.kind === 'impact') rows.push({ k: 'Behind ' + ix, v: raw(SX, d) })
      if (SY.kind === 'impact') rows.push({ k: 'Behind ' + iy, v: raw(SY, d) })
      if (two) rows.push({ k: 'Average z-score', v: signed(d.imp, 2) + rank(d, d.rImp), good: d.z >= 0 })
      return rows
    },
    values,
    impact: d => signed(d.imp, 2),
    words: { low: 'Below average', high: 'Above average', chipX: `Above-avg ${ix}`, chipY: `Above-avg ${iy}`, chipGood: two ? 'Above avg combined' : null,
      best: scored.length ? (two ? 'Best ' : 'Highest ') + both : 'Above average', worst: scored.length ? 'Lowest ' + both : 'Below average' },
    th1: th(SX, ix), th2: th(SY, iy),
    lines,
  }
}

/** A chart's words and guides with the two axes exchanged (rows keep x and y; the chart draws their px and py). */
export function flipMeta(M: ChartMeta): ChartMeta {
  return {
    ...M, xTitle: M.yTitle, yTitle: M.xTitle, tickX: M.tickY, tickY: M.tickX, minStepX: M.minStepY, minStepY: M.minStepX,
    signedX: M.signedY, signedY: M.signedX, avgXText: M.avgYText, avgYText: M.avgXText,
    quads: [M.quads[0], M.quads[2], M.quads[1], M.quads[3]],
    curves: b => M.curves({ vx0: b.vy0, vx1: b.vy1, vy0: b.vx0, vy1: b.vx1 })
      .map(c => ({ ...c, pts: c.pts.map((p): [number, number] => [p[1], p[0]]), at: c.at ? [c.at[1], c.at[0]] : null })),
    words: { ...M.words, chipX: M.words.chipY, chipY: M.words.chipX }, th1: M.th2, th2: M.th1,
  }
}

export interface ScatterChart {
  rule: ChartRule
  data: ScatterData
  view: ScatterView
  meta: ChartMeta
  /** Per game unless a shooting chart shows totals. */
  unit: ShotUnit
}

/**
 * The chart for a pair of axes: who is on it, how they are scored, and its words.
 * `minMin` (minutes per game) applies whenever minutes are on an axis.
 */
export function buildChart(sp: ShotPool, cx: StatId, cy: StatId, unit: ShotUnit, scope: ShotScope, minMin: number): ScatterChart {
  const rule = ruleOf(cx, cy)
  const hasMin = cx === 'MIN' || cy === 'MIN'
  const floor = (p: Player) => !hasMin || p.stats.minutes / games(p) >= minMin
  // A picked team also shows its players outside the top 200, measured against it.
  const extras = () => {
    if (!isScoped(scope)) return []
    const inPool = new Set(sp.pool)
    return sp.eligible.filter(p => inScope(p, { nba: scope.nba, fantasy: scope.fantasy }) && !inPool.has(p) && floor(p))
  }
  let data: ScatterData, meta: ChartMeta
  const shown: ShotUnit = rule.kind === 'shot' ? unit : 'pg'
  if (rule.kind === 'rate') {
    data = deriveRates(sp.eligible.filter(floor), sp.frank, STATS[rule.stat])
    meta = rateMeta(data, rule.stat)
  } else if (rule.kind === 'shot') {
    data = deriveShots(sp.pool, extras(), sp.frank, rule.chart, unit)
    meta = shotMeta(data, rule.chart, unit)
  } else {
    // With minutes on an axis the viewer's minutes floor applies to the top 200 too.
    data = deriveCustom(sp.pool.filter(floor), extras(), sp.frank, STATS[cx], STATS[cy])
    meta = customMeta(data, cx, cy)
  }
  if (!rule.flip) return { rule, data, view: data, meta, unit: shown }
  for (const d of data.rows) { d.px = d.y; d.py = d.x }
  return { rule, data, view: { avgX: data.avgY, avgY: data.avgX, x0: data.y0, x1: data.y1, y0: data.x0, y1: data.x1 }, meta: flipMeta(meta), unit: shown }
}

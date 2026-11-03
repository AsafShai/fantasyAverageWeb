// A classic heat scale: grey for a slim chance, through yellow and orange, to red
// for a likely finish. Stops are evenly spaced along the scale.
const LIGHT_RAMP = ['#f3f4f6', '#fdf6d8', '#fde68a', '#fcc24a', '#f7962a', '#ea6a1c', '#d13a1f', '#9f1d1d']
const DARK_RAMP = ['#1f2937', '#3a3427', '#5e4419', '#8f5310', '#c2560e', '#e0631a', '#ef4b3c', '#f98a7a']
const EMPTY = { light: '#f9fafb', dark: '#111827' }

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function sampleRamp(ramp: string[], t: number): string {
  const x = Math.min(Math.max(t, 0), 1) * (ramp.length - 1)
  const i = Math.min(Math.floor(x), ramp.length - 2)
  const f = x - i
  const a = hexToRgb(ramp[i])
  const b = hexToRgb(ramp[i + 1])
  const [r, g, bl] = a.map((v, k) => Math.round(v + (b[k] - v) * f))
  return `rgb(${r},${g},${bl})`
}

/**
 * Heatmap shading for a finishing-place probability (0–1), shared by the
 * Estimator page and its share card. The square root spreads the small
 * chances apart: early in the season most cells sit between 2% and 25%, and
 * a straight scale would paint them all nearly the same pale colour.
 */
export function getProbColor(prob: number, isDark: boolean): { bg: string; text: string } {
  if (prob <= 0) return { bg: isDark ? EMPTY.dark : EMPTY.light, text: 'transparent' }
  const t = Math.sqrt(Math.min(prob, 1))
  if (isDark) {
    // Text switches where the other colour reads better (contrast about 4 or more).
    return { bg: sampleRamp(DARK_RAMP, t), text: t > 0.6 ? '#1a0f08' : '#ffffff' }
  }
  return { bg: sampleRamp(LIGHT_RAMP, t), text: t > 0.76 ? '#ffffff' : '#3b2a1a' }
}

export function formatRankProbabilityPercent(prob: number): string {
  if (prob <= 0) return ''
  return `${(prob * 100).toFixed(1)}%`
}

/** Average finishing place: Σ place · chance. */
export function expectedPlace(probs: Map<number, number>): number {
  let sum = 0
  for (const [place, prob] of probs) sum += place * prob
  return sum
}

export interface HeatmapRow {
  team_id: number
  team_name: string
  /** place → probability */
  probs: Map<number, number>
}

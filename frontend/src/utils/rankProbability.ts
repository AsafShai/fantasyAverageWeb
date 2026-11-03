/** Heatmap shading for a finishing-place probability (0–1), shared by the
 * Estimator page and its share card. */
export function getProbColor(prob: number, isDark: boolean): { bg: string; text: string } {
  if (prob === 0) return { bg: isDark ? 'rgb(17,24,39)' : 'rgb(240,245,255)', text: isDark ? 'transparent' : '#aaa' }
  if (isDark) {
    // dark: dark navy (low) → bright steel blue (high), no white
    const r = Math.round(30  + prob * (56  - 30))
    const g = Math.round(50  + prob * (130 - 50))
    const b = Math.round(80  + prob * (200 - 80))
    return {
      bg: `rgb(${r},${g},${b})`,
      text: prob > 0.4 ? 'white' : '#93c5fd',
    }
  }
  const intensity = Math.round(prob * 255)
  const r = Math.round(255 - intensity * (255 - 8) / 255)
  const g = Math.round(255 - intensity * (255 - 81) / 255)
  const b = Math.round(255 - intensity * (255 - 156) / 255)
  return {
    bg: `rgb(${r},${g},${b})`,
    text: prob > 0.5 ? 'white' : prob > 0.2 ? '#1a3a5c' : '#555',
  }
}

export function formatRankProbabilityPercent(prob: number): string {
  if (prob <= 0) return ''
  return `${(prob * 100).toFixed(1)}%`
}

export interface HeatmapRow {
  team_id: number
  team_name: string
  /** place → probability */
  probs: Map<number, number>
}

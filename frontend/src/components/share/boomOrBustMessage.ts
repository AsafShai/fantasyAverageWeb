import type { SurpriseRow } from '../../types/api'

const STAT_LABELS: Record<string, string> = { FG3M: '3PM', FG_PCT: 'FG%', FT_PCT: 'FT%' }
const MAX_NAMES = 5

/** "38 PTS (avg 20.7)": the stat that drove the score, for the line under a name. */
export function topReason(row: SurpriseRow): string | null {
  const r = row.reasons[0]
  if (!r) return null
  const label = STAT_LABELS[r.stat] ?? r.stat
  if (r.stat === 'FG_PCT' || r.stat === 'FT_PCT') return `${Math.round(r.value * 100)}% ${label}`
  const value = Number.isInteger(r.value) ? String(r.value) : r.value.toFixed(1)
  return r.avg == null ? `${value} ${label}` : `${value} ${label} (avg ${r.avg.toFixed(1)})`
}

const fmtScore = (score: number) => `${score < 0 ? '−' : '+'}${Math.abs(score).toFixed(1)}`

/** "38 PTS, 5 STL": the two stats that drove the score, compact. */
function drivers(row: SurpriseRow): string {
  return row.reasons.slice(0, 2).map((r) => {
    const label = STAT_LABELS[r.stat] ?? r.stat
    if (r.stat === 'FG_PCT' || r.stat === 'FT_PCT') return `${Math.round(r.value * 100)}% ${label}`
    return `${Number.isInteger(r.value) ? r.value : r.value.toFixed(1)} ${label}`
  }).join(', ')
}

function names(rows: SurpriseRow[]): string {
  if (rows.length === 0) return '_nobody_'
  const shown = rows.slice(0, MAX_NAMES).map((r) => {
    const why = drivers(r)
    return `*${r.player_name}* ${fmtScore(r.score)}${why ? ` (${why})` : ''}`
  })
  const more = rows.length - shown.length
  return shown.join(', ') + (more > 0 ? ` +${more} more` : '')
}

/** The caption that goes with the shared image: four short lines in WhatsApp's
 * own formatting (*bold*, _italic_), booms and busts each on one line. */
export function buildShareMessage(dateLabel: string, booms: SurpriseRow[], busts: SurpriseRow[], url: string): string {
  return [
    `💥 *Boom or Bust* · ${dateLabel}`,
    `🚀 Booms: ${names(booms)}`,
    `💩 Busts: ${names(busts)}`,
    `🔗 ${url}`,
  ].join('\n')
}

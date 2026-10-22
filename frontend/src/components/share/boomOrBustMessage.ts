import type { SurpriseRow } from '../../types/api'

const STAT_LABELS: Record<string, string> = { FG3M: '3PM', FG_PCT: 'FG%', FT_PCT: 'FT%' }
const MAX_NAMES = 5

/** "38 PTS": the first driver without the average, for the narrow share card. */
export function shortReason(row: SurpriseRow): string | null {
  const r = row.reasons[0]
  if (!r) return null
  const label = STAT_LABELS[r.stat] ?? r.stat
  if (r.stat === 'FG_PCT' || r.stat === 'FT_PCT') return `${Math.round(r.value * 100)}% ${label}`
  return `${Number.isInteger(r.value) ? r.value : r.value.toFixed(1)} ${label}`
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
    const team = r.fantasy_team_name || r.fantasy_team
    const owner = r.fantasy_team === null ? ' · FA' : team ? ` · ${team}${r.started === false ? ' (bench)' : ''}` : ''
    return `*${r.player_name}* ${fmtScore(r.score)}${why ? ` (${why})` : ''}${owner}`
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

/** Table column each driving stat lands in: counting stats on their own
 * column, makes/attempts/percentage on the shooting cell. */
const DRIVER_COLUMN: Record<string, string> = {
  PTS: 'pts', REB: 'reb', AST: 'ast', FG3M: 'fg3m', STL: 'stl', BLK: 'blk',
  FGM: 'fg', FGA: 'fg', FG_PCT: 'fg', FTM: 'ft', FTA: 'ft', FT_PCT: 'ft',
}

/** The columns to mark in a row and the sign of each: 'good' when the stat was
 * above the player's norm, 'bad' when below, whatever table the row is in. */
export function driverColumns(row: SurpriseRow): Map<string, { sign: 'good' | 'bad'; z: number }> {
  const out = new Map<string, { sign: 'good' | 'bad'; z: number }>()
  for (const r of row.reasons) {
    const col = DRIVER_COLUMN[r.stat]
    if (col && !out.has(col)) out.set(col, { sign: r.z >= 0 ? 'good' : 'bad', z: r.z })
  }
  return out
}

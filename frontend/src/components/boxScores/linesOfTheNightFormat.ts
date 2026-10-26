import type { SlatePlayerValue } from '../../types/boxScore'

import type { SlateValues } from '../../types/boxScore'

/** What a Z on the box score means, for tooltips and the share card. */
export function zExplainer(basis: SlateValues['basis']): string {
  return basis === 'season'
    ? "Player Rankings value of this one game: scored against the Rankings pool (season per-game stats, top 300) over the league's categories. +1.5 = a game worth what a +1.5 player averages."
    : "Scored against every player who played that night (season stats were unavailable), over the league's categories."
}

export function signedZ(z: number): string {
  return z > 0 ? `+${z.toFixed(2)}` : z.toFixed(2)
}

/** "52 PTS · 8 REB · 10 AST · 2 STL · 8 3PM": the counting line, zeros past AST left out. */
export function lineSummary(player: SlatePlayerValue): string {
  const parts = [`${player.pts} PTS`, `${player.reb} REB`, `${player.ast} AST`]
  if (Number(player.stl) > 0) parts.push(`${player.stl} STL`)
  if (Number(player.blk) > 0) parts.push(`${player.blk} BLK`)
  const threes = player.fg3.split('-')[0]
  if (Number(threes) > 0) parts.push(`${threes} 3PM`)
  return parts.join(' · ')
}

/** The caption that goes with the image, in WhatsApp's own formatting. */
export function buildLinesMessage(dateLabel: string, players: SlatePlayerValue[], url: string): string {
  const rows = players.map((player, index) => {
    const owner = player.fantasy_team_name ?? player.fantasy_team ?? 'FA'
    return `${index + 1}. *${player.name}* ${signedZ(player.z)} (${lineSummary(player)}) · ${owner}`
  })
  return [`🔥 *Lines of the night* · ${dateLabel}`, ...rows, url].join('\n')
}

import type { SlatePlayerValue } from '../../types/boxScore'

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

import type { PlayerStint } from '../../types/activity'
import { formatDay } from '../../utils/leagueActivity'

export const signedZ = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}`

/** What the rank and z-score next to a traded player mean, in plain words. */
export const VALUE_EXPLAINER =
  'Rank and Z-score compare his per-game stats on the new team with every player over the same dates, ' +
  'the way Player Rankings does for a date range. Rank 1 is the best player over those dates; ' +
  'a Z-score of 0 is an average top-300 player, higher is better.'

/** One-line legend shown under the pills. */
export const VALUE_LEGEND =
  'Rank: place among all players over the same dates (1 = best). Z-score: per-game value, 0 = an average top-300 player.'

export function rankTone(rank: number): string {
  if (rank <= 50) return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
  if (rank <= 150) return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'
  return 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
}

export function valueTitle(stint: PlayerStint): string | undefined {
  const v = stint.value
  if (!v) return undefined
  return `${formatDay(stint.start)} – ${formatDay(stint.end)}: rank ${v.rank} of ${v.of} players over those dates, ` +
    `Z-score ${signedZ(v.z)}\nBy category: ` +
    Object.keys(v.cat_z).map(c => `${c} rank ${v.cat_rank[c]} (${signedZ(v.cat_z[c])})`).join(' · ')
}

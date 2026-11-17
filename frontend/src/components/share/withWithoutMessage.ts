import { formatZ, type MatchMode } from '../../utils/withWithout'

/** "both sat" / "all sat" only when more than one player is sitting. */
export function withoutModeLabel(count: number, mode: MatchMode): string | null {
  if (count < 2) return null
  if (count > 2) return mode === 'all' ? 'all sat' : 'any sat'
  return mode === 'all' ? 'both sat' : 'either sat'
}

/** Caption that rides with the image. The page link does not restore the picks,
 * so the image is what carries the comparison. */
export function buildWithWithoutMessage(
  player: string,
  names: string,
  modeLabel: string | null,
  zDelta: number | null,
  withGames: number,
  withoutGames: number,
  url: string,
): string {
  const sitting = modeLabel ? `without ${names} (${modeLabel})` : `without ${names}`
  const z = zDelta === null ? 'Z change —' : `Z change ${formatZ(zDelta)}`
  return [
    `*${player}* ${sitting}`,
    `${z} · ${withGames} with / ${withoutGames} without`,
    `🔗 ${url}`,
  ].join('\n')
}

export const withWithoutShareUrl = () => `${window.location.origin}/with-without`

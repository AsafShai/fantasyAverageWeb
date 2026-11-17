import { formatZ } from '../../utils/withWithout'

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

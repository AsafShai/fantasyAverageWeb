import { toListHeadshotUrl } from './adp'

/** ESPN's logo slug differs from the site's team codes for a few franchises. */
const ESPN_LOGO_SLUG: Record<string, string> = {
  UTA: 'utah',
  NOP: 'no',
  NYK: 'ny',
  GSW: 'gs',
  SAS: 'sa',
  WAS: 'wsh',
  PHL: 'phi',
  PHO: 'phx',
}

/**
 * ESPN team logo by team code (ATL, PHL, GSW…). `size` asks ESPN's image
 * resizer for a small copy (list rows); without it, the full 500px file.
 */
export function nbaTeamLogoUrl(abbr: string, size?: number): string {
  const key = abbr.trim().toUpperCase()
  const slug = ESPN_LOGO_SLUG[key] ?? key.toLowerCase()
  const path = `/i/teamlogos/nba/500/${slug}.png`
  return size ? `https://a.espncdn.com/combiner/i?img=${path}&w=${size}&h=${size}` : `https://a.espncdn.com${path}`
}

/** Small ESPN headshot for list rows, by ESPN athlete id. */
export function playerHeadshotUrl(playerId: string | number): string {
  return toListHeadshotUrl(`https://a.espncdn.com/i/headshots/nba/players/full/${playerId}.png`)!
}

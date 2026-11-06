/**
 * The player sheet lives in the URL: `?player=<ESPN athlete id>` on whatever
 * page it was opened from, so it can be shared and reloaded, and browser back
 * closes it. Router state marks entries the sheet pushed itself (`mrPlayer`),
 * which tells "close" whether stepping back stays on the site.
 */
export const PLAYER_PARAM = 'player'
export const PLAYER_STATE_KEY = 'mrPlayer'

/** `search` with `?player=` set to `id` (other params kept). */
export function searchWithPlayer(search: string, id: string): string {
  const params = new URLSearchParams(search)
  params.set(PLAYER_PARAM, id)
  return `?${params.toString()}`
}

/** `search` without `?player=` ('' when nothing is left). */
export function searchWithoutPlayer(search: string): string {
  const params = new URLSearchParams(search)
  params.delete(PLAYER_PARAM)
  const rest = params.toString()
  return rest ? `?${rest}` : ''
}

/** The player id in `search`, or null. */
export function playerFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get(PLAYER_PARAM)
  return id && id.trim() !== '' ? id.trim() : null
}

/** `/player/123` → '123' (search results and profile links). */
export function playerIdFromPath(path: string): string | null {
  const m = /^\/player\/([^/?#]+)\/?$/.exec(path)
  return m ? decodeURIComponent(m[1]) : null
}

/**
 * Router state for an entry that opens the sheet: the current state minus
 * any other open sheet, marked as pushed by the player sheet.
 */
export function openSheetState(state: unknown): Record<string, unknown> {
  const rest = { ...((state ?? {}) as Record<string, unknown>) }
  delete rest.mrSheet
  return { ...rest, [PLAYER_STATE_KEY]: true }
}

import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { PLAYER_STATE_KEY, openSheetState, playerFromSearch, searchWithPlayer, searchWithoutPlayer } from './playerParam'

/**
 * Open/close for the player sheet. The open player is `?player=` in the URL;
 * opening pushes a history entry, so the phone's back button closes the sheet
 * before it leaves the page.
 */
export function usePlayerSheet() {
  const location = useLocation()
  const navigate = useNavigate()
  const playerId = playerFromSearch(location.search)
  const state = (location.state ?? null) as Record<string, unknown> | null

  /** Opens the sheet over the current page. `replace` swaps the current entry (search overlay). */
  const open = useCallback(
    (id: string, opts: { replace?: boolean } = {}) => {
      navigate(
        { pathname: location.pathname, search: searchWithPlayer(location.search, id), hash: location.hash },
        { replace: opts.replace, state: openSheetState(state) },
      )
    },
    [navigate, location.pathname, location.search, location.hash, state],
  )

  const close = useCallback(() => {
    if (!playerId) return
    // We pushed this entry: step back over it. Opened from a shared link or a
    // reload instead: there may be nothing of ours behind it, so replace.
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (state?.[PLAYER_STATE_KEY] && idx > 0) {
      navigate(-1)
      return
    }
    const rest = { ...(state ?? {}) }
    delete rest[PLAYER_STATE_KEY]
    navigate(
      { pathname: location.pathname, search: searchWithoutPlayer(location.search), hash: location.hash },
      { replace: true, state: Object.keys(rest).length ? rest : null },
    )
  }, [playerId, state, navigate, location.pathname, location.search, location.hash])

  /**
   * Leaves the sheet for another page, replacing the sheet's entry so back
   * from there returns to the page the sheet was opened on.
   */
  const leaveTo = useCallback(
    (path: string, extraState?: Record<string, unknown>) => {
      navigate(path, { replace: true, state: extraState })
    },
    [navigate],
  )

  /** Page behind the sheet, for "← Back to …" on the profile. */
  const behind = `${location.pathname}${searchWithoutPlayer(location.search)}`

  return { playerId, open, close, leaveTo, behind }
}

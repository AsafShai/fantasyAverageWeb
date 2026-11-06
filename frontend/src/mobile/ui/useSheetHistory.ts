import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router'

const KEY = 'mrSheet'

/**
 * Open/close state for a bottom sheet that lives in browser history, so the
 * phone's back button closes the sheet first and only then leaves the page.
 * Opening pushes a history entry for the same URL (marked in router state);
 * closing from the UI steps back over that entry.
 */
export function useSheetHistory(id: string) {
  const location = useLocation()
  const navigate = useNavigate()
  const state = (location.state ?? null) as Record<string, unknown> | null
  const open = state?.[KEY] === id

  const show = useCallback(() => {
    if (open) return
    navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { state: { ...(state ?? {}), [KEY]: id } },
    )
  }, [open, navigate, location.pathname, location.search, location.hash, state, id])

  const hide = useCallback(() => {
    if (!open) return
    // React Router keeps its own index in history.state. If the sheet entry
    // is the first one we own (page reloaded with the sheet open), stepping
    // back would leave the site, so replace the entry instead.
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else {
      const rest = { ...(state ?? {}) }
      delete rest[KEY]
      navigate(
        { pathname: location.pathname, search: location.search, hash: location.hash },
        { replace: true, state: Object.keys(rest).length ? rest : null },
      )
    }
  }, [open, navigate, location.pathname, location.search, location.hash, state])

  return { open, show, hide }
}

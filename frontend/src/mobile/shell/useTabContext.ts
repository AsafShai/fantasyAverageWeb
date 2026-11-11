import { useEffect, useMemo } from 'react'
import { useLocation } from 'react-router'
import { useMyTeam } from '../../context/MyTeamContext'
import { usePersistedState } from '../../hooks/usePersistedState'
import { currentTabIndex, getTab, type TabContext, type TabDef } from './tabs'

/** A page worth coming back to: its address without the player sheet's `?player=`. */
function recentKey(pathname: string, search: string): string {
  const params = new URLSearchParams(search)
  params.delete('player')
  const rest = params.toString()
  return rest ? `${pathname}?${rest}` : pathname
}

/**
 * The tabs of the bar plus what shortcuts need to resolve: my team and the Recent
 * page. Recent remembers the last two pages opened from outside the bar, and
 * points at the other one when you are standing on the latest. That makes it a
 * back-and-forth between two off-bar pages, never a link to where you already are.
 */
export function useBarTabs(tabIds: string[]) {
  const { pathname, search } = useLocation()
  const { myTeamId } = useMyTeam()
  const [recent, setRecent] = usePersistedState<string[]>('mobile.recentPages', [])

  const tabs = useMemo(() => tabIds.map(getTab).filter((t): t is TabDef => t !== undefined), [tabIds])

  const here = recentKey(pathname, search)
  const recentPath = recent[0] === here ? (recent[1] ?? null) : (recent[0] ?? null)
  const ctx: TabContext = { myTeamId, recentPath }
  const current = currentTabIndex(tabs, pathname, search, ctx)

  useEffect(() => {
    if (current !== -1 || pathname === '/settings') return
    setRecent((prev) => (prev[0] === here ? prev : [here, ...prev].slice(0, 2)))
  }, [current, pathname, here, setRecent])

  return { tabs, ctx, current }
}

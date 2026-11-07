import { useMemo } from 'react'
import { usePersistedState, usePersistedSetState } from './usePersistedState'
import { useGetAllPlayersQuery, useGetNbaTeamDepthChartQuery } from '../store/api/fantasyApi'
import { applyDepthChartFilters } from '../utils/depthChartFilters'

export const DEPTH_MAX = 5
export const DEPTH_LABELS = ['Starter', '2nd', '3rd', '4th', '5th']
export const DEPTH_EXCLUDE_STATUSES = ['Out', 'Doubtful', 'Questionable', 'Probable'] as const

/**
 * NBA Teams depth chart: data, the free-agent set and the Exclude filters
 * (kept per team in local storage). Shared by the desktop and phone layouts.
 */
export function useNbaDepthChart(teamId: string) {
  const { data, isLoading, error } = useGetNbaTeamDepthChartQuery(teamId)
  const { data: playersData } = useGetAllPlayersQuery({ limit: 1200 })
  const freeAgentIds = useMemo(() => {
    const ids = new Set<string>()
    for (const player of playersData?.players ?? []) {
      if (player.player_id != null && player.status === 'FREEAGENT') ids.add(String(player.player_id))
    }
    return ids
  }, [playersData])
  const [excludedStatuses, setExcludedStatuses] = usePersistedSetState<string>(`nbaTeams.${teamId}.excludedStatuses`, new Set())
  const [removeDuplicates, setRemoveDuplicates] = usePersistedState(`nbaTeams.${teamId}.removeDuplicates`, false)

  const toggleStatus = (status: string) => {
    setExcludedStatuses((prev) => {
      const next = new Set(prev)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return next
    })
  }

  const positions = data ? applyDepthChartFilters(data.positions, excludedStatuses, removeDuplicates) : []

  return { data, isLoading, error, freeAgentIds, excludedStatuses, toggleStatus, removeDuplicates, setRemoveDuplicates, positions }
}

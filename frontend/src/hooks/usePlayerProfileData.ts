import { useMemo } from 'react'
import { useGetAllPlayersQuery, useGetNbaPlayerQuery, useGetNbaPlayerStatsQuery } from '../store/api/fantasyApi'
import type { CustomDateRange, TimePeriod } from '../types/api'
import { orderCategories } from '../utils/statOrder'
import { DEFAULT_CATEGORIES, getPlayerRankSummary } from '../utils/playerRankings'

/** Label for the page's time frame ("Full Season", "Nov 1 – Nov 5" …). */
export function timePeriodLabel(period: TimePeriod, range: CustomDateRange | null): string {
  if (period === 'custom') {
    if (!range) return 'Custom'
    const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    return `${fmt(range.start)} – ${fmt(range.end)}`
  }
  const labels: Partial<Record<TimePeriod, string>> = {
    season: 'Full Season', last_7: 'Last 7 Days', last_15: 'Last 15 Days', last_30: 'Last 30 Days',
  }
  return labels[period] ?? period
}

/** "← Back to Players" etc., from the page the profile was opened from. */
export function backLabel(from: string | undefined): string {
  if (!from) return '← Back'
  if (from.startsWith('/nba-teams')) return '← Back to NBA Teams'
  if (from.startsWith('/box-scores')) return '← Back to Box Scores'
  if (from.startsWith('/players')) return '← Back to Players'
  if (from.startsWith('/team/')) return '← Back to Team'
  if (from.startsWith('/player-rankings')) return '← Back to Player Rankings'
  return '← Back'
}

/**
 * Everything the Player profile reads, shared by the desktop page and the
 * phone layout so both show the same numbers from the same requests.
 */
export function usePlayerProfileData(playerId: string, timePeriod: TimePeriod, customRange: CustomDateRange | null) {
  const bioQuery = useGetNbaPlayerQuery(playerId, { skip: !playerId })

  const customParams =
    timePeriod === 'custom' && customRange
      ? { start: customRange.start, end: customRange.end }
      : {}

  const statsQuery = useGetNbaPlayerStatsQuery(
    { playerId, time_period: timePeriod, ...customParams },
    { skip: !playerId || (timePeriod === 'custom' && !customRange) },
  )

  // Fantasy roster status (owner / free agent) — reuses the same paginated
  // players list the Players/Projections pages already query, so it's often
  // already warm in the RTK Query cache rather than a fresh fetch.
  const { data: allPlayers, isLoading: allPlayersLoading } = useGetAllPlayersQuery({ page: 1, limit: 1200 })
  const fantasyEntry = allPlayers?.players.find((p) => p.player_id === Number(playerId))

  // Rank + z-score follow the page's time frame: the same players list Player
  // Rankings ranks for that period, ranked client-side the same way. On Full
  // Season this is the query above (the cache key normalises the period).
  const {
    data: periodPlayers,
    isFetching: periodPlayersFetching,
  } = useGetAllPlayersQuery(
    { page: 1, limit: 1200, time_period: timePeriod, ...customParams },
    { skip: timePeriod === 'custom' && !customRange },
  )

  const apiCategories = allPlayers?.categories
  const rankCategories = useMemo(
    () => orderCategories(apiCategories?.length ? apiCategories : DEFAULT_CATEGORIES),
    [apiCategories],
  )
  const rankSummary = useMemo(() => {
    if (!periodPlayers) return null
    return getPlayerRankSummary(
      periodPlayers.players,
      Number(playerId),
      rankCategories,
      new Set(periodPlayers.reverse_categories ?? []),
    )
  }, [periodPlayers, playerId, rankCategories])

  return {
    bio: bioQuery.data,
    bioError: bioQuery.error,
    bioLoading: bioQuery.isLoading,
    statsResponse: statsQuery.data,
    statsError: statsQuery.error,
    statsLoading: statsQuery.isLoading,
    statsFetching: statsQuery.isFetching,
    allPlayers,
    allPlayersLoading,
    fantasyEntry,
    periodPlayersFetching,
    apiCategories,
    rankCategories,
    rankSummary,
    periodLabel: timePeriodLabel(timePeriod, customRange),
  }
}

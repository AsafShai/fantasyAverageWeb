import { useLayoutEffect, useRef, useState } from 'react'
import { useGetLeagueSummaryQuery, useGetRankingsQuery, useGetTodayHubQuery } from '../store/api/fantasyApi'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import DeadlineCountdown from '../components/DeadlineCountdown'
import RankMovers from '../components/today/RankMovers'
import RosterHealth from '../components/today/RosterHealth'
import { getErrorMessage } from '../utils/errorMessage'
import { FF_TODAY_HUB } from '../config/featureFlags'
import type { AverageStats, RankingStats } from '../types/api'

const AVERAGE_TILES: { label: string; value: (a: AverageStats) => string }[] = [
  { label: 'GP', value: a => a.gp.toFixed(2) },
  { label: 'FG%', value: a => a.fg_percentage.toFixed(3) },
  { label: 'FT%', value: a => a.ft_percentage.toFixed(3) },
  { label: '3PM', value: a => a.three_pm.toFixed(2) },
  { label: 'AST', value: a => a.ast.toFixed(2) },
  { label: 'REB', value: a => a.reb.toFixed(2) },
  { label: 'STL', value: a => a.stl.toFixed(2) },
  { label: 'BLK', value: a => a.blk.toFixed(2) },
  { label: 'PTS', value: a => a.pts.toFixed(2) },
]

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-2 py-1.5 dark:bg-gray-700">
      <p className="text-[9.5px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">{label}</p>
      <p className="text-sm font-bold tabular-nums text-gray-900 sm:text-base dark:text-gray-50">{value}</p>
    </div>
  )
}

function formatSlate(slateDate: string | null): string {
  if (!slateDate) return 'No games scheduled'
  return new Date(slateDate + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function useMatchDesktopHeight(deps: unknown[]) {
  const targetRef = useRef<HTMLDivElement>(null)
  const [heightPx, setHeightPx] = useState<number | null>(null)

  useLayoutEffect(() => {
    const node = targetRef.current
    if (!node) return

    const isDesktop = () => window.matchMedia('(min-width: 768px)').matches

    const measure = () => {
      setHeightPx(isDesktop() ? node.getBoundingClientRect().height : null)
    }

    measure()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    observer?.observe(node)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { targetRef, heightPx }
}

const Dashboard = () => {
  const { data: summary, error: summaryError, isLoading: summaryLoading } = useGetLeagueSummaryQuery()
  const { data: rankings, error: rankingsError, isLoading: rankingsLoading } = useGetRankingsQuery({})
  const { data: hub, isLoading: hubLoading } = useGetTodayHubQuery(undefined, { skip: !FF_TODAY_HUB })
  const { targetRef: rosterRef, heightPx: rosterHeightPx } = useMatchDesktopHeight([hub])

  if (summaryLoading || rankingsLoading) {
    return <LoadingSpinner />
  }

  if (summaryError || rankingsError) {
    return <ErrorMessage message={getErrorMessage(summaryError ?? rankingsError, 'Failed to load dashboard data')} />
  }

  const topTeams = rankings?.averages_rankings.slice(0, 5) || []

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 sm:space-y-6 sm:px-6 lg:px-8">
      <DeadlineCountdown />

      {FF_TODAY_HUB && (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-bold text-gray-900 sm:text-2xl dark:text-gray-50">Today</h1>
          <span className="text-[11px] text-gray-400 sm:text-xs dark:text-gray-500">
            {hub ? `${formatSlate(hub.slate_date)} · ${hub.games_count} games` : 'loading slate…'}
          </span>
        </div>
      )}

      {FF_TODAY_HUB &&
        (hubLoading ? (
          <LoadingSpinner />
        ) : (
          <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[2fr_3fr]">
            <RankMovers movers={hub?.movers ?? []} matchHeightPx={rosterHeightPx} />
            <div ref={rosterRef}>
              <RosterHealth
                slateDate={hub?.slate_date ?? null}
                gamesCount={hub?.games_count ?? 0}
                teams={hub?.roster_health ?? []}
              />
            </div>
          </div>
        ))}

      {summary && (
        <div className="rounded-lg bg-white p-4 shadow dark:bg-gray-800">
          <div className="flex items-baseline justify-between gap-2 pb-2">
            <h2 className="text-base font-bold text-gray-900 sm:text-lg dark:text-gray-50">League averages</h2>
            <span className="text-[11px] text-gray-400 dark:text-gray-500">per team, season to date</span>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {AVERAGE_TILES.map(tile => (
              <StatTile key={tile.label} label={tile.label} value={tile.value(summary.league_averages)} />
            ))}
            <StatTile label="NBA pace" value={(summary.nba_avg_pace ?? 0).toFixed(1)} />
            <StatTile label="Days left" value={String(summary.nba_game_days_left ?? 0)} />
            <StatTile label="Teams" value={String(summary.total_teams)} />
          </div>
        </div>
      )}

      <div className="rounded-lg bg-white p-4 shadow sm:p-6 dark:bg-gray-800">
        <h2 className="pb-3 text-base font-bold text-gray-900 sm:text-lg dark:text-gray-50">Top 5 Teams (average)</h2>
        <div className="space-y-2">
          {topTeams.map((team: RankingStats, index: number) => (
            <div
              key={team.team.team_id}
              className="flex items-center justify-between rounded-lg bg-gray-50 p-2.5 dark:bg-gray-700"
            >
              <div className="flex items-center space-x-3">
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                  {index + 1}
                </span>
                <span className="text-xs font-medium text-gray-900 sm:text-sm dark:text-gray-100">
                  {team.team.team_name}
                </span>
              </div>
              <div className="text-right">
                <span className="text-sm font-bold tabular-nums text-gray-900 sm:text-base dark:text-gray-50">
                  {team.total_points}
                </span>
                <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">pts</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default Dashboard

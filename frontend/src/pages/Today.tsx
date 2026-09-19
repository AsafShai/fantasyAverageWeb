import { useGetLeagueSummaryQuery, useGetRankingsQuery, useGetTodayHubQuery } from '../store/api/fantasyApi'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import DeadlineCountdown from '../components/DeadlineCountdown'
import RankMovers from '../components/today/RankMovers'
import RosterHealth from '../components/today/RosterHealth'
import LeagueAverages from '../components/today/LeagueAverages'
import TopTeams from '../components/today/TopTeams'
import { getErrorMessage } from '../utils/errorMessage'

function formatSlate(slateDate: string | null): string {
  if (!slateDate) return 'No games scheduled'
  return new Date(slateDate + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

const Today = () => {
  const { data: summary, error: summaryError, isLoading: summaryLoading } = useGetLeagueSummaryQuery()
  const { data: rankings, error: rankingsError, isLoading: rankingsLoading } = useGetRankingsQuery({})
  const { data: hub, isLoading: hubLoading } = useGetTodayHubQuery()

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

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-900 sm:text-2xl dark:text-gray-50">Today</h1>
        <span className="text-[11px] text-gray-400 sm:text-xs dark:text-gray-500">
          {hub ? `${formatSlate(hub.slate_date)} · ${hub.games_count} games` : 'loading slate…'}
        </span>
      </div>

      {hubLoading ? (
        <LoadingSpinner />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[2fr_3fr]">
          <RankMovers movers={hub?.movers ?? []} />
          <div className="min-w-0">
            <RosterHealth
              slateDate={hub?.slate_date ?? null}
              gamesCount={hub?.games_count ?? 0}
              teams={hub?.roster_health ?? []}
            />
          </div>
        </div>
      )}

      {summary && <LeagueAverages summary={summary} />}

      <TopTeams teams={topTeams} />
    </div>
  )
}

export default Today

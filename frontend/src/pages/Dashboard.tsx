import { useGetLeagueSummaryQuery, useGetRankingsQuery } from '../store/api/fantasyApi'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'

const Dashboard = () => {
  const { data: summary, error: summaryError, isLoading: summaryLoading } = useGetLeagueSummaryQuery()
  const { data: rankings, error: rankingsError, isLoading: rankingsLoading } = useGetRankingsQuery({})

  if (summaryLoading || rankingsLoading) {
    return <LoadingSpinner />
  }

  if (summaryError || rankingsError) {
    return <ErrorMessage message="Failed to load dashboard data" />
  }

  const topTeams = rankings?.rankings.slice(0, 5) || []

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">League Overview</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-blue-50 p-4 rounded-lg">
            <h3 className="font-semibold text-blue-900">Total Teams</h3>
            <p className="text-2xl font-bold text-blue-600">{summary?.total_teams}</p>
          </div>
          <div className="bg-green-50 p-4 rounded-lg">
            <h3 className="font-semibold text-green-900">Games Played</h3>
            <p className="text-2xl font-bold text-green-600">{summary?.total_games_played}</p>
          </div>
          <div className="bg-purple-50 p-4 rounded-lg">
            <h3 className="font-semibold text-purple-900">Avg PPG</h3>
            <p className="text-2xl font-bold text-purple-600">
              {summary?.league_averages.pts.toFixed(4)}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Top 5 Teams (average)</h2>
        <div className="space-y-3">
          {topTeams.map((team, index) => (
            <div
              key={team.team.team_id}
              className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
            >
              <div className="flex items-center space-x-3">
                <span className="flex-shrink-0 w-8 h-8 bg-blue-100 text-blue-800 rounded-full flex items-center justify-center text-sm font-medium">
                  {index + 1}
                </span>
                <span className="font-medium">{team.team.team_name}</span>
              </div>
              <div className="text-right">
                <span className="text-lg font-bold text-gray-900">
                  {team.total_points}
                </span>
                <span className="text-sm text-gray-500 ml-1">pts</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default Dashboard
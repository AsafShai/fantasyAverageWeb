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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
          <div className="bg-blue-50 p-4 rounded-lg">
            <h3 className="font-semibold text-blue-900">Total Teams</h3>
            <p className="text-2xl font-bold text-blue-600">{summary?.total_teams}</p>
          </div>
          <div className="bg-green-50 p-4 rounded-lg">
            <h3 className="font-semibold text-green-900">Avg GP</h3>
            <p className="text-2xl font-bold text-green-600">{summary?.league_averages.gp.toFixed(4)}</p>
          </div>
          <div className="bg-purple-50 p-4 rounded-lg">
            <h3 className="font-semibold text-purple-900">Avg FG%</h3>
            <p className="text-2xl font-bold text-purple-600">
              {summary?.league_averages.fg_percentage.toFixed(4)}
            </p>
          </div>
          <div className="bg-pink-50 p-4 rounded-lg">
            <h3 className="font-semibold text-pink-900">Avg FT%</h3>
            <p className="text-2xl font-bold text-pink-600">
              {summary?.league_averages.ft_percentage.toFixed(4)}
            </p>
          </div>
          <div className="bg-indigo-50 p-4 rounded-lg">
            <h3 className="font-semibold text-indigo-900">Avg 3PM</h3>
            <p className="text-2xl font-bold text-indigo-600">
              {summary?.league_averages.three_pm.toFixed(4)}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="bg-yellow-50 p-4 rounded-lg">
            <h3 className="font-semibold text-yellow-900">Avg AST</h3>
            <p className="text-2xl font-bold text-yellow-600">
              {summary?.league_averages.ast.toFixed(4)}
            </p>
          </div>
          <div className="bg-red-50 p-4 rounded-lg">
            <h3 className="font-semibold text-red-900">Avg REB</h3>
            <p className="text-2xl font-bold text-red-600">
              {summary?.league_averages.reb.toFixed(4)}
            </p>
          </div>
          <div className="bg-teal-50 p-4 rounded-lg">
            <h3 className="font-semibold text-teal-900">Avg STL</h3>
            <p className="text-2xl font-bold text-teal-600">
              {summary?.league_averages.stl.toFixed(4)}
            </p>
          </div>
          <div className="bg-orange-50 p-4 rounded-lg">
            <h3 className="font-semibold text-orange-900">Avg BLK</h3>
            <p className="text-2xl font-bold text-orange-600">
              {summary?.league_averages.blk.toFixed(4)}
            </p>
          </div>
          <div className="bg-cyan-50 p-4 rounded-lg">
            <h3 className="font-semibold text-cyan-900">Avg PTS</h3>
            <p className="text-2xl font-bold text-cyan-600">
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
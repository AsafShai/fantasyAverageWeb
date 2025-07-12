import { useParams } from 'react-router-dom'
import { useGetTeamDetailQuery } from '../store/api/fantasyApi'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'

const TeamDetail = () => {
  const { teamId } = useParams<{ teamId: string }>()
  const teamIdNumber = teamId ? parseInt(teamId, 10) : 0
  const { data: team_detail, error, isLoading } = useGetTeamDetailQuery(teamIdNumber)

  if (isLoading) return <LoadingSpinner />
  if (error) return <ErrorMessage message="Failed to load team details" />
  if (!team_detail) return <ErrorMessage message="Team not found" />

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">{team_detail.team.team_name}</h1>
        <div className="flex items-center space-x-4 mb-10">
          <span className="text-gray-600">Total Games Played:</span>
          <span className="font-semibold">{team_detail.raw_averages.gp}</span>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h2 className="text-xl font-semibold mb-4">Shot Chart Stats</h2>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span>Field Goals:</span>
                <span>{team_detail.shot_chart.fgm}/{team_detail.shot_chart.fga} ({(team_detail.shot_chart.fg_percentage * 100).toFixed(4)}%)</span>
              </div>
              <div className="flex justify-between">
                <span>Free Throws:</span>
                <span>{team_detail.shot_chart.ftm}/{team_detail.shot_chart.fta} ({(team_detail.shot_chart.ft_percentage * 100).toFixed(4)}%)</span>
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-4">Per-Game Averages</h2>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span>Points:</span>
                <span>{team_detail.raw_averages.pts.toFixed(4)}</span>
              </div>
              <div className="flex justify-between">
                <span>Rebounds:</span>
                <span>{team_detail.raw_averages.reb.toFixed(4)}</span>
              </div>
              <div className="flex justify-between">
                <span>Assists:</span>
                <span>{team_detail.raw_averages.ast.toFixed(4)}</span>
              </div>
              <div className="flex justify-between">
                <span>Steals:</span>
                <span>{team_detail.raw_averages.stl.toFixed(4)}</span>
              </div>
              <div className="flex justify-between">
                <span>Blocks:</span>
                <span>{team_detail.raw_averages.blk.toFixed(4)}</span>
              </div>
              <div className="flex justify-between">
                <span>3-Pointers:</span>
                <span>{team_detail.raw_averages.three_pm.toFixed(4)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6">
          <h2 className="text-xl font-semibold mb-4">Ranking Summary (Averages)</h2>
          <div className="bg-blue-50 p-4 rounded-lg">
            <div className="flex justify-between items-center">
              <span className="text-lg font-medium">Overall Rank:</span>
              <span className="text-2xl font-bold text-blue-600">#{team_detail.ranking_stats.rank}</span>
            </div>
            <div className="flex justify-between items-center mt-2">
              <span className="text-lg font-medium">Total Points:</span>
              <span className="text-2xl font-bold text-blue-600">{team_detail.ranking_stats.total_points}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default TeamDetail
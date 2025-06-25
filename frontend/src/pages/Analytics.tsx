import { useGetHeatmapDataQuery } from '../store/api/fantasyApi'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'

const Analytics = () => {
  const { data: heatmapData, error, isLoading } = useGetHeatmapDataQuery()

  if (isLoading) return <LoadingSpinner />
  if (error) return <ErrorMessage message="Failed to load analytics data" />

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">League Analytics</h1>
        
        <div className="mb-6">
          <h2 className="text-xl font-semibold mb-4">Performance Heatmap</h2>
          <p className="text-gray-600 mb-4">
            Visual representation of team performance across different categories.
            Darker colors indicate better performance relative to other teams.
          </p>
          
          {heatmapData && (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th className="px-4 py-2 text-left">Team</th>
                    {heatmapData.categories.map((category) => (
                      <th key={category} className="px-2 py-2 text-center text-xs">
                        {category}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {heatmapData.teams.map((team, teamIndex) => (
                    <tr key={team}>
                      <td className="px-4 py-2 font-medium">{team}</td>
                      {heatmapData.normalized_data[teamIndex]?.map((value, catIndex) => (
                        <td
                          key={catIndex}
                          className="px-2 py-2 text-center text-xs"
                          style={{
                            backgroundColor: `rgba(59, 130, 246, ${value})`,
                            color: value > 0.5 ? 'white' : 'black'
                          }}
                        >
                          {heatmapData.data[teamIndex]?.[catIndex]?.toFixed(4)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-gray-50 p-4 rounded-lg">
          <h3 className="font-semibold mb-2">Coming Soon:</h3>
          <ul className="text-sm text-gray-600 space-y-1">
            <li>• Interactive charts with Recharts</li>
            <li>• Team comparison tool</li>
            <li>• Trend analysis over time</li>
            <li>• Advanced statistical insights</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

export default Analytics
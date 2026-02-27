import { Link } from 'react-router-dom'
import { useGetTeamsListQuery } from '../store/api/fantasyApi'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'

const Teams = () => {
  const { data: teams, error, isLoading } = useGetTeamsListQuery()

  if (isLoading) return <LoadingSpinner />
  if (error) return <ErrorMessage message="Failed to load teams" />
  if (!teams || teams.length === 0) return <ErrorMessage message="No teams found" />

  return (
    <div className="max-w-7xl mx-auto px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-2">
          Teams
        </h1>
        <p className="text-gray-600">Browse all teams in your fantasy league</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {teams.map((team) => (
          <Link
            key={team.team_id}
            to={`/team/${team.team_id}`}
            className="block bg-white rounded-lg shadow hover:shadow-lg transition-shadow duration-200 p-6"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-1">
                  {team.team_name}
                </h3>
                <p className="text-sm text-gray-500">Team #{team.team_id}</p>
              </div>
              <svg
                className="w-6 h-6 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

export default Teams

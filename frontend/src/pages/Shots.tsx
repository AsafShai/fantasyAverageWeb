import { useState } from 'react'
import { useGetLeagueShotsQuery } from '../store/api/fantasyApi'
import { Link } from 'react-router-dom'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import type { TeamShotStats } from '../types/api'

const Shots = () => {
  const [sortBy, setSortBy] = useState<string>('fg_percentage')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  
  const { data, error, isLoading } = useGetLeagueShotsQuery()

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(column)
      setSortOrder('desc')
    }
  }

  const formatPercentage = (value: number) => {
    return (value * 100).toFixed(4) + '%'
  }

  let leagueAverageFG = 0
  let leagueAverageFT = 0
  if (data?.shots) {
    leagueAverageFG = data.shots.reduce((acc, curr) => acc + curr.fg_percentage, 0) / data.shots.length
    leagueAverageFT = data.shots.reduce((acc, curr) => acc + curr.ft_percentage, 0) / data.shots.length
  } 


  const getPercentageColor = (percentage: number, type: 'fg' | 'ft') => {
    if (type === 'fg') {
      if (percentage >= leagueAverageFG) return 'text-green-600'
      if (percentage >= leagueAverageFG - 0.03) return 'text-yellow-600'
      return 'text-red-600'
    } 
    if (type === 'ft') {
      if (percentage >= leagueAverageFT) return 'text-green-600'
      if (percentage >= leagueAverageFT - 0.03) return 'text-yellow-600'
      return 'text-red-600'
    }
  }

  if (isLoading) return <LoadingSpinner />
  if (error) return <ErrorMessage message="Failed to load shots data" />

  const rawShots = data?.shots || []
  
  // Sort the data client-side
  const shots = [...rawShots].sort((a, b) => {
    let aValue = a[sortBy as keyof TeamShotStats]
    let bValue = b[sortBy as keyof TeamShotStats]
    
    // Handle numeric sorting
    if (typeof aValue === 'number' && typeof bValue === 'number') {
      return sortOrder === 'asc' ? aValue - bValue : bValue - aValue
    }
    
    let aTeamName = a.team.team_name.toLowerCase()
    let bTeamName = b.team.team_name.toLowerCase()
    if (aTeamName && bTeamName && aTeamName < bTeamName) return sortOrder === 'asc' ? -1 : 1
    if (aTeamName && bTeamName && aTeamName > bTeamName) return sortOrder === 'asc' ? 1 : -1
    return 0
  })

  const columns = [
    { key: 'team', label: 'Team', sortable: true },
    { key: 'fgm', label: 'FGM', sortable: true },
    { key: 'fga', label: 'FGA', sortable: true },
    { key: 'fg_percentage', label: 'FG%', sortable: true },
    { key: 'ftm', label: 'FTM', sortable: true },
    { key: 'fta', label: 'FTA', sortable: true },
    { key: 'ft_percentage', label: 'FT%', sortable: true },
    { key: 'gp', label: 'GP', sortable: true },
  ]

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="card">
        <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-orange-600 to-red-600 rounded-t-lg">
          <h2 className="text-2xl font-bold text-white">League Shooting Statistics</h2>
          <p className="text-orange-100 mt-1">
            Field goal and free throw shooting stats for all teams. Click column headers to sort.
          </p>
        </div>
      
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`table-header ${
                    column.sortable ? 'cursor-pointer hover:bg-gray-100 transition-colors duration-150' : ''
                  }`}
                  onClick={() => column.sortable && handleSort(column.key)}
                >
                  <div className="flex items-center">
                    {column.label}
                    {column.sortable && sortBy === column.key && (
                      <span className="ml-1">
                        {sortOrder === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {shots.map((team: TeamShotStats) => (
              <tr key={team.team.team_id} className="hover:bg-orange-50 transition-colors duration-150 border-b border-gray-100">
                <td className="table-cell">
                  <Link
                    to={`/team/${team.team.team_id}`}
                    className="text-orange-600 hover:text-orange-800 font-semibold transition-colors duration-150 hover:underline"
                  >
                    {team.team.team_name}
                  </Link>
                </td>
                <td className="table-cell font-medium">{team.fgm}</td>
                <td className="table-cell font-medium">{team.fga}</td>
                <td className={`table-cell font-medium ${getPercentageColor(team.fg_percentage, 'fg')}`}>
                  {formatPercentage(team.fg_percentage)}
                </td>
                <td className="table-cell font-medium">{team.ftm}</td>
                <td className="table-cell font-medium">{team.fta}</td>
                <td className={`table-cell font-medium ${getPercentageColor(team.ft_percentage, 'ft')}`}>
                  {formatPercentage(team.ft_percentage)}
                </td>
                <td className="table-cell font-medium">{team.gp}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>
    </div>
  )
}

export default Shots
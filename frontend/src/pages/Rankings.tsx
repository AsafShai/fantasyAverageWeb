import { useState } from 'react'
import { useGetRankingsQuery } from '../store/api/fantasyApi'
import { Link } from 'react-router-dom'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import type { RankingStats } from '../types/api'

const Rankings = () => {
  const [sortBy, setSortBy] = useState<string>('total_points')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  
  const { data, error, isLoading } = useGetRankingsQuery({})

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(column)
      setSortOrder('desc')
    }
  }

  if (isLoading) return <LoadingSpinner />
  if (error) return <ErrorMessage message="Failed to load rankings" />

  const rawRankings = data?.rankings || []
  
  const rankings = [...rawRankings].sort((a, b) => {
    let aValue = a[sortBy as keyof RankingStats]
    let bValue = b[sortBy as keyof RankingStats]
        
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
    { key: 'rank', label: 'Rank', sortable: false },
    { key: 'team', label: 'Team', sortable: true },
    { key: 'fg_percentage', label: 'FG%', sortable: true },
    { key: 'ft_percentage', label: 'FT%', sortable: true },
    { key: 'three_pm', label: '3PM', sortable: true },
    { key: 'ast', label: 'AST', sortable: true },
    { key: 'reb', label: 'REB', sortable: true },
    { key: 'stl', label: 'STL', sortable: true },
    { key: 'blk', label: 'BLK', sortable: true },
    { key: 'pts', label: 'PTS', sortable: true },
    { key: 'total_points', label: 'Total', sortable: true },
    { key: 'gp', label: 'GP', sortable: true },
  ]

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="card">
        <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-600 to-blue-700 rounded-t-lg">
          <h2 className="text-2xl font-bold text-white">Team Rankings (Averages)</h2>
          <p className="text-blue-100 mt-1">
            Click column headers to sort. Total points calculated from category rankings.
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
                  } ${column.key === 'gp' ? 'border-l-2 border-gray-300' : ''}`}
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
            {rankings.map((team: RankingStats, index: number) => (
              <tr key={team.team.team_id} className="hover:bg-blue-50 transition-colors duration-150 border-b border-gray-100">
                <td className="table-cell font-bold text-blue-600">
                  #{team.rank || index + 1}
                </td>
                <td className="table-cell">
                  <Link
                    to={`/team/${team.team.team_id}`}
                    className="text-blue-600 hover:text-blue-800 font-semibold transition-colors duration-150 hover:underline"
                  >
                    {team.team.team_name}
                  </Link>
                </td>
                {columns.slice(2).map((column) => {
                  const value = team[column.key as keyof RankingStats] as number
                  const formatValue = (val: number) => {
                    if (column.key === 'gp') return val
                    return val % 1 === 0 ? val.toString() : val.toFixed(1)
                  }
                  return (
                    <td key={column.key} className={`table-cell font-medium ${column.key === 'gp' ? 'border-l-2 border-gray-300' : ''}`}>
                      {typeof value === 'number' ? formatValue(value) : value}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>
    </div>
  )
}

export default Rankings
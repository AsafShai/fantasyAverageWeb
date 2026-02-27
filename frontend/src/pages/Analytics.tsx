import { useState, type JSX } from 'react'
import { useGetHeatmapDataQuery } from '../store/api/fantasyApi'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import type { HeatmapData, Team } from '../types/api'
import { getHeatmapColor, getTextColor } from '../utils/colorUtils'

interface SortedHeatmapData {
  teams: Team[]
  categories: string[]
  data: number[][]
  normalized_data: number[][]
  ranks_data: number[][]
}
interface TeamDataItem {
  team: Team
  index: number
  data: number[]
  normalized_data: number[]
  ranks_data: number[]
}


const Analytics = () => {
  const [sortBy, setSortBy] = useState<string | null>(null)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [highlightedTeamId, setHighlightedTeamId] = useState<number | null>(null)
  const { data: heatmapData, error, isLoading } = useGetHeatmapDataQuery()

  const handleTeamClick = (teamId: number) => {
    setHighlightedTeamId(prev => prev === teamId ? null : teamId)
  }

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(column)
      setSortOrder(column === 'team' ? 'asc' : 'desc')
    }
  }

  if (isLoading) return <LoadingSpinner />
  if (error) return <ErrorMessage message="Failed to load analytics data" />

  const getSortedHeatmapData = (heatmapData: HeatmapData): SortedHeatmapData | null => {
    if (!heatmapData) return null

    const { teams, categories, data, normalized_data, ranks_data } = heatmapData

    const teamData: TeamDataItem[] = teams.map((team: Team, index: number) => ({
      team,
      index,
      data: data[index] ?? [],
      normalized_data: normalized_data[index] ?? [],
      ranks_data: ranks_data?.[index] ?? []
    }))

    if (sortBy === null) {
      return {
        teams,
        categories,
        data,
        normalized_data,
        ranks_data: ranks_data ?? []
      }
    }

    const sortedTeamData: TeamDataItem[] = teamData.sort((a: TeamDataItem, b: TeamDataItem) => {
      if (sortBy === 'team') {
        const aValue = a.team.team_name.toLowerCase()
        const bValue = b.team.team_name.toLowerCase()
        if (aValue < bValue) return sortOrder === 'asc' ? -1 : 1
        if (aValue > bValue) return sortOrder === 'asc' ? 1 : -1
        return 0
      } else {
        const categoryIndex = categories.indexOf(sortBy)
        if (categoryIndex === -1) return 0

        const aValue: number = a.data[categoryIndex] ?? 0
        const bValue: number = b.data[categoryIndex] ?? 0
        return sortOrder === 'asc' ? aValue - bValue : bValue - aValue
      }
    })

    return {
      teams: sortedTeamData.map((item: TeamDataItem) => item.team),
      categories,
      data: sortedTeamData.map((item: TeamDataItem) => item.data),
      normalized_data: sortedTeamData.map((item: TeamDataItem) => item.normalized_data),
      ranks_data: sortedTeamData.map((item: TeamDataItem) => item.ranks_data)
    }
  }

  const renderHeatmapTable = (data: HeatmapData | undefined, title: string, description: string): JSX.Element | null => {
    if (!data) return null
    
    const sortedData: SortedHeatmapData | null = getSortedHeatmapData(data)
    if (!sortedData) return null

    return (
      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-4">{title}</h2>
        <p className="text-gray-600 mb-4">{description}</p>
        
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr>
                <th 
                  className="px-4 py-2 text-left cursor-pointer hover:bg-gray-100 transition-colors duration-150"
                  onClick={() => handleSort('team')}
                >
                  <div className="flex items-center">
                    Team
                    {sortBy === 'team' && (
                      <span className="ml-1">
                        {sortOrder === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </div>
                </th>
                {sortedData.categories.map((category: string) => (
                  <th
                    key={category}
                    className="px-2 py-2 text-center text-xs cursor-pointer hover:bg-gray-100 transition-colors duration-150"
                    onClick={() => handleSort(category)}
                  >
                    <div className="flex items-center justify-center">
                      {category}
                      {sortBy === category && (
                        <span className="ml-1">
                          {sortOrder === 'asc' ? '↑' : '↓'}
                        </span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedData.teams.map((team: Team, teamIndex: number) => {
                const isHighlighted = highlightedTeamId === team.team_id
                return (
                  <tr
                    key={team.team_id}
                    className={`transition-all duration-150 ${
                      isHighlighted ? 'border-[3px] border-black' : ''
                    }`}
                  >
                    <td
                      className={`px-4 py-2 cursor-pointer transition-colors duration-150 ${
                        isHighlighted ? 'font-bold' : 'font-medium hover:bg-gray-100'
                      }`}
                      onClick={() => handleTeamClick(team.team_id)}
                    >
                      {team.team_name}
                    </td>
                    {sortedData.normalized_data[teamIndex]?.map((value: number, catIndex: number) => {
                      const cellValue: number | undefined = sortedData.data[teamIndex]?.[catIndex]
                      const rank: number | undefined = sortedData.ranks_data[teamIndex]?.[catIndex]
                      const category = sortedData.categories[catIndex]
                      const isPercentage = category === 'FG%' || category === 'FT%'
                      const displayValue = category === 'GP'
                        ? Math.round(cellValue ?? 0)
                        : isPercentage
                        ? ((cellValue ?? 0) * 100).toFixed(4) + '%'
                        : (cellValue?.toFixed(4) ?? '0.0000')
                      return (
                        <td
                          key={catIndex}
                          className={`px-2 py-2 text-center text-xs relative ${
                            category === 'GP' ? 'border-l-4 border-gray-700' : ''
                          }`}
                          style={{
                            backgroundColor: getHeatmapColor(value),
                            color: getTextColor(value)
                          }}
                        >
                          <span>{displayValue}</span>
                          {rank !== undefined && rank > 0 && (
                            <span className="absolute bottom-0.5 right-0.5 text-[0.7rem] opacity-85 font-semibold">
                              ({rank})
                            </span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">League Analytics</h1>
        
        {renderHeatmapTable(
          heatmapData,
          "Performance Heatmap",
          "Visual representation of team performance across different categories. Red indicates below-average performance, white indicates league-average performance, and green indicates above-average performance. Click column headers to sort by team name or category values."
        )}

      </div>
    </div>
  )
}

export default Analytics
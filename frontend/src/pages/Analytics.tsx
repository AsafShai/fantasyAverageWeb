import { useState, type JSX } from 'react'
import { useGetHeatmapDataQuery } from '../store/api/fantasyApi'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import type { HeatmapData } from '../types/api'

interface SortedHeatmapData {
  teams: string[]
  categories: string[]
  data: number[][]
  normalized_data: number[][]
}
interface TeamDataItem {
  team: string
  index: number
  data: number[]
  normalized_data: number[]
}


const Analytics = () => {
  const [sortBy, setSortBy] = useState<string>('team')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const { data: heatmapData, error, isLoading } = useGetHeatmapDataQuery()

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

  // Generic sorting function for any heatmap data structure
  const getSortedHeatmapData = (heatmapData: HeatmapData): SortedHeatmapData | null => {
    if (!heatmapData) return null

    const { teams, categories, data, normalized_data } = heatmapData
    
    // Create array of indices with their corresponding data
    const teamData: TeamDataItem[] = teams.map((team: string, index: number) => ({
      team,
      index,
      data: data[index] ?? [],
      normalized_data: normalized_data[index] ?? []
    }))

    // Sort the team data
    const sortedTeamData: TeamDataItem[] = teamData.sort((a: TeamDataItem, b: TeamDataItem) => {
      if (sortBy === 'team') {
        const aValue = a.team.toLowerCase()
        const bValue = b.team.toLowerCase()
        if (aValue < bValue) return sortOrder === 'asc' ? -1 : 1
        if (aValue > bValue) return sortOrder === 'asc' ? 1 : -1
        return 0
      } else {
        // Sort by category value
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
      normalized_data: sortedTeamData.map((item: TeamDataItem) => item.normalized_data)
    }
  }

  // Generic heatmap table component
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
              {sortedData.teams.map((team: string, teamIndex: number) => (
                <tr key={team}>
                  <td className="px-4 py-2 font-medium">{team}</td>
                  {sortedData.normalized_data[teamIndex]?.map((value: number, catIndex: number) => {
                    const cellValue: number | undefined = sortedData.data[teamIndex]?.[catIndex]
                    return (
                      <td
                        key={catIndex}
                        className="px-2 py-2 text-center text-xs"
                        style={{
                          backgroundColor: `rgba(59, 130, 246, ${value})`,
                          color: value > 0.5 ? 'white' : 'black'
                        }}
                      >
                        {cellValue?.toFixed(4) ?? '0.0000'}
                      </td>
                    )
                  })}
                </tr>
              ))}
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
        
        {/* Current heatmap - will be replaced with tabs in future */}
        {renderHeatmapTable(
          heatmapData,
          "Performance Heatmap",
          "Visual representation of team performance across different categories. Darker colors indicate better performance relative to other teams. Click column headers to sort by team name or category values."
        )}

        <div className="bg-gray-50 p-4 rounded-lg">
          <h3 className="font-semibold mb-2">Coming Soon:</h3>
          <ul className="text-sm text-gray-600 space-y-1">
            <li>• Tab navigation: League Average | Above Gaps | Below Gaps</li>
            <li>• Category gap heatmaps showing rank improvement targets</li>
            <li>• Interactive charts with Recharts</li>
            <li>• Team comparison tool</li>
            <li>• Trend analysis over time</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

export default Analytics
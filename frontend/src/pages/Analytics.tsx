import { useState, type JSX } from 'react'
import { useGetHeatmapDataQuery } from '../store/api/fantasyApi'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import type { HeatmapData, Team } from '../types/api'

interface SortedHeatmapData {
  teams: Team[]
  categories: string[]
  data: number[][]
  normalized_data: number[][]
}
interface TeamDataItem {
  team: Team
  index: number
  data: number[]
  normalized_data: number[]
}


const Analytics = () => {
  const [sortBy, setSortBy] = useState<string>('team')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const { data: heatmapData, error, isLoading } = useGetHeatmapDataQuery()

  const getHeatmapColor = (normalizedValue: number): string => {
    // Red (bad) -> White (middle) -> Green (good)
    // normalizedValue ranges from 0 to 1, with 0.5 being pure white
    
    // Apply a power function to expand the white zone
    // This makes values near 0.5 closer to white
    const adjustedValue = normalizedValue < 0.5 
      ? 0.5 * Math.pow(normalizedValue * 2, 1.5) 
      : 1 - 0.5 * Math.pow((1 - normalizedValue) * 2, 1.5);
    
    if (adjustedValue <= 0.5) {
      const ratio = adjustedValue * 2;
      const r = Math.round(215 + (255 - 215) * ratio); // 215 -> 255
      const g = Math.round(48 + (255 - 48) * ratio);   // 48 -> 255
      const b = Math.round(39 + (255 - 39) * ratio);   // 39 -> 255
      return `rgb(${r}, ${g}, ${b})`;
    } else {
      const ratio = (adjustedValue - 0.5) * 2;
      const r = Math.round(255 - (255 - 34) * ratio);  // 255 -> 34
      const g = Math.round(255 - (255 - 197) * ratio); // 255 -> 197
      const b = Math.round(255 - (255 - 94) * ratio);  // 255 -> 94
      return `rgb(${r}, ${g}, ${b})`;
    }
  }

  const getTextColor = (normalizedValue: number): string => {
    if (normalizedValue < 0.25) {
      return 'white';
    } else if (normalizedValue > 0.75) {
      return 'white';
    }
    return 'black';
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

    const { teams, categories, data, normalized_data } = heatmapData
    
    const teamData: TeamDataItem[] = teams.map((team: Team, index: number) => ({
      team,
      index,
      data: data[index] ?? [],
      normalized_data: normalized_data[index] ?? []
    }))

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
      normalized_data: sortedTeamData.map((item: TeamDataItem) => item.normalized_data)
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
              {sortedData.teams.map((team: Team, teamIndex: number) => (
                <tr key={team.team_id}>
                  <td className="px-4 py-2 font-medium">{team.team_name}</td>
                  {sortedData.normalized_data[teamIndex]?.map((value: number, catIndex: number) => {
                    const cellValue: number | undefined = sortedData.data[teamIndex]?.[catIndex]
                    const category = sortedData.categories[catIndex]
                    const displayValue = category === 'GP'
                      ? Math.round(cellValue ?? 0)
                      : (cellValue?.toFixed(4) ?? '0.0000')
                    return (
                      <td
                        key={catIndex}
                        className="px-2 py-2 text-center text-xs"
                        style={{
                          backgroundColor: getHeatmapColor(value),
                          color: getTextColor(value)
                        }}
                      >
                        {displayValue}
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
import { useState, useEffect, type JSX } from 'react'
import { useGetHeatmapDataQuery, useGetLeagueSummaryQuery } from '../store/api/fantasyApi'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import DataDateBadge from '../components/DataDateBadge'
import RankingsOverTimeChart from '../components/RankingsOverTimeChart'
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

const formatDate = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

const Analytics = () => {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    const obs = new MutationObserver(() => setIsDark(document.documentElement.classList.contains('dark')))
    obs.observe(document.documentElement, { attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])

  const [sortBy, setSortBy] = useState<string | null>(null)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [highlightedTeamId, setHighlightedTeamId] = useState<number | null>(null)
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [dateError, setDateError] = useState<string>('')
  const [appliedDates, setAppliedDates] = useState<{ startDate?: string; endDate?: string }>({})

  const today = new Date().toISOString().split('T')[0]

  function getDateNDaysAgo(n: number): string {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().split('T')[0];
  }

  const { data: heatmapData, error, isLoading } = useGetHeatmapDataQuery(appliedDates)
  const { data: summary } = useGetLeagueSummaryQuery()

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

  const handleStartDate = (val: string) => {
    setStartDate(val)
    validateDates(val, endDate)
  }

  const handleEndDate = (val: string) => {
    setEndDate(val)
    validateDates(startDate, val)
  }

  const validateDates = (start: string, end: string) => {
    if (!start || !end) {
      setDateError('')
      return
    }
    if (start >= end) {
      setDateError('Start date must be before end date')
    } else {
      setDateError('')
    }
  }

  const applyDates = () => {
    if (!startDate || !endDate || dateError) return
    setAppliedDates({ startDate, endDate })
  }

  const clearDates = () => {
    setStartDate('')
    setEndDate('')
    setDateError('')
    setAppliedDates({})
  }

  if (isLoading) return <LoadingSpinner />
  if (error) return <ErrorMessage message="Failed to load analytics data" />

  const isDateRangeActive = appliedDates.startDate && appliedDates.endDate
  const hasDateMismatch = heatmapData && isDateRangeActive && (
    (heatmapData.actual_start_date && heatmapData.actual_start_date !== heatmapData.date_range_start) ||
    (heatmapData.actual_end_date && heatmapData.actual_end_date !== heatmapData.date_range_end)
  )

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

    const titleWithRange = isDateRangeActive
      ? <>{title}<span className="ml-2 text-lg font-normal text-gray-500">– {formatDate(appliedDates.startDate!)} - {formatDate(appliedDates.endDate!)}</span></>
      : title

    return (
      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-2">{titleWithRange}</h2>

        <div className="mb-2 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-600 font-medium">From</label>
            <input
              type="date"
              value={startDate}
              min={summary?.season_start}
              max={endDate || today}
              onChange={(e) => handleStartDate(e.target.value)}
              className="px-3 py-1.5 rounded-md text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-600 font-medium">To</label>
              <button
                onClick={() => handleEndDate(today)}
                className="text-xs text-blue-500 hover:text-blue-700 underline"
              >
                Today
              </button>
            </div>
            <input
              type="date"
              value={endDate}
              min={startDate || summary?.season_start}
              max={today}
              onChange={(e) => handleEndDate(e.target.value)}
              className="px-3 py-1.5 rounded-md text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <button
            onClick={applyDates}
            disabled={!startDate || !endDate || !!dateError}
            className="px-4 py-1.5 text-sm font-semibold bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Apply
          </button>
          {(startDate || endDate) && (
            <button
              onClick={clearDates}
              className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white border border-gray-300 dark:border-gray-600 hover:border-gray-500 rounded-md transition-colors"
            >
              Clear
            </button>
          )}
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {[1, 7, 15, 30].map(days => (
            <button
              key={days}
              onClick={() => {
                const start = getDateNDaysAgo(days);
                setStartDate(start);
                setEndDate(today);
                setDateError('');
              }}
              className="px-2 py-0.5 text-xs rounded bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors"
            >
              Last {days}d
            </button>
          ))}
        </div>

        {dateError && (
          <p className="mb-3 text-sm text-red-600">{dateError}</p>
        )}

        {hasDateMismatch && (
          <div className="mb-3 px-4 py-2 bg-amber-50 dark:bg-gray-700 border border-amber-200 dark:border-gray-600 rounded-md text-sm text-amber-700 dark:text-amber-300">
            Note: closest available data used - showing {formatDate(heatmapData!.actual_start_date!)} - {formatDate(heatmapData!.actual_end_date!)}
          </div>
        )}

        <p className="text-gray-600 mb-4">{description}</p>

        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr>
                <th
                  className="px-4 py-2 text-left cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-150"
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
                    className="px-2 py-2 text-center text-xs cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-150 border-l border-gray-200 dark:border-gray-700"
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
                      isHighlighted ? 'border-[3px] border-black dark:border-white' : ''
                    }`}
                  >
                    <td
                      className={`px-4 py-2 cursor-pointer transition-colors duration-150 ${
                        isHighlighted ? 'font-bold' : 'font-medium hover:bg-gray-100 dark:hover:bg-gray-700'
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
                          className={`px-2 py-2 text-center text-xs relative border-l border-gray-300 dark:border-gray-600 ${
                            category === 'GP' ? 'border-l-4 border-gray-700 dark:border-gray-400' : ''
                          }`}
                          style={{
                            backgroundColor: getHeatmapColor(value, isDark),
                            color: getTextColor(value, isDark)
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
        <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
          <h1 className="text-2xl font-bold text-gray-900">League Analytics</h1>
          <DataDateBadge dataDate={heatmapData?.data_date} />
        </div>

        {renderHeatmapTable(
          heatmapData,
          "Performance Heatmap",
          "Visual representation of team performance across different categories. Red indicates below-average performance, white indicates league-average performance, and green indicates above-average performance. Click column headers to sort by team name or category values."
        )}

      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <RankingsOverTimeChart />
      </div>
    </div>
  )
}

export default Analytics

import { useState } from 'react'
import { useGetRankingsQuery, useGetLeagueSummaryQuery } from '../store/api/fantasyApi'
import { Link } from 'react-router-dom'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import DataDateBadge from '../components/DataDateBadge'
import type { RankingStats } from '../types/api'

const formatDate = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

const Rankings = () => {
  const [sortBy, setSortBy] = useState<string>('total_points')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [mode, setMode] = useState<'averages' | 'totals'>('averages')
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

  const { data, error, isLoading } = useGetRankingsQuery(appliedDates)
  const { data: summary, isLoading: summaryLoading } = useGetLeagueSummaryQuery()

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

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(column)
      setSortOrder('desc')
    }
  }

  if (isLoading || summaryLoading) return <LoadingSpinner />
  if (error) return <ErrorMessage message="Failed to load rankings" />

  const rawRankings = mode === 'averages'
    ? (data?.averages_rankings || [])
    : (data?.totals_rankings || [])

  const rankings = [...rawRankings].sort((a, b) => {
    let aValue = a[sortBy as keyof RankingStats]
    let bValue = b[sortBy as keyof RankingStats]
    if (typeof aValue === 'number' && typeof bValue === 'number') {
      return sortOrder === 'asc' ? aValue - bValue : bValue - aValue
    }
    let aTeamName = a.team.team_name.toLowerCase()
    let bTeamName = b.team.team_name.toLowerCase()
    if (aTeamName < bTeamName) return sortOrder === 'asc' ? -1 : 1
    if (aTeamName > bTeamName) return sortOrder === 'asc' ? 1 : -1
    return 0
  })

  const columns = [
    { key: 'rank', label: 'Rank', sortable: true },
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

  const isDateRangeActive = appliedDates.startDate && appliedDates.endDate
  const hasDateMismatch = data && isDateRangeActive && (
    (data.actual_start_date && data.actual_start_date !== data.date_range_start) ||
    (data.actual_end_date && data.actual_end_date !== data.date_range_end)
  )

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {data?.data_date && (
        <div className="mb-4 flex justify-end">
          <DataDateBadge dataDate={data.data_date} />
        </div>
      )}
      {(summary?.nba_avg_pace || summary?.nba_game_days_left !== undefined) && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:flex sm:justify-center sm:gap-4">
          {summary?.nba_avg_pace && (
            <div className="flex flex-col items-center gap-2 bg-white px-3 py-2 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow sm:flex-row sm:gap-3 sm:px-5 sm:py-3">
              <div className="flex items-center justify-center w-8 h-8 bg-amber-100 rounded-full sm:w-10 sm:h-10">
                <span className="text-lg sm:text-xl">⚡</span>
              </div>
              <div className="text-center sm:text-left">
                <div className="text-xs text-gray-500 font-medium">NBA Avg Pace</div>
                <div className="text-xl font-bold text-gray-900 sm:text-2xl">{summary.nba_avg_pace.toFixed(1)}</div>
              </div>
            </div>
          )}
          {summary?.nba_game_days_left !== undefined && summary.nba_game_days_left !== null && (
            <div className="flex flex-col items-center gap-2 bg-white px-3 py-2 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow sm:flex-row sm:gap-3 sm:px-5 sm:py-3">
              <div className="flex items-center justify-center w-8 h-8 bg-emerald-100 rounded-full sm:w-10 sm:h-10">
                <span className="text-lg sm:text-xl">📅</span>
              </div>
              <div className="text-center sm:text-left">
                <div className="text-xs text-gray-500 font-medium">Days Remaining</div>
                <div className="text-xl font-bold text-gray-900 sm:text-2xl">{summary.nba_game_days_left}</div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-600 to-blue-700 rounded-t-lg">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold text-white">
                Team Rankings ({mode === 'averages' ? 'Averages' : 'Totals'})
                {isDateRangeActive && (
                  <span className="ml-2 text-lg font-normal text-blue-100">
                    – {formatDate(appliedDates.startDate!)} - {formatDate(appliedDates.endDate!)}
                  </span>
                )}
              </h2>
              <p className="text-blue-100 mt-1">
                {mode === 'averages'
                  ? 'Click column headers to sort. Total points calculated from category rankings.'
                  : 'Totals mode: raw accumulated stats for the period.'}
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => setMode('averages')}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  mode === 'averages'
                    ? 'bg-white text-blue-700'
                    : 'bg-blue-500 text-white hover:bg-blue-400'
                }`}
              >
                Averages
              </button>
              <button
                onClick={() => setMode('totals')}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  mode === 'totals'
                    ? 'bg-white text-blue-700'
                    : 'bg-blue-500 text-white hover:bg-blue-400'
                }`}
              >
                Totals
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-blue-100 font-medium">From</label>
              <input
                type="date"
                value={startDate}
                min={summary?.season_start}
                max={endDate || today}
                onChange={(e) => handleStartDate(e.target.value)}
                className="px-3 py-1.5 rounded-md text-sm text-gray-800 bg-white border border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <label className="text-xs text-blue-100 font-medium">To</label>
                <button
                  onClick={() => handleEndDate(today)}
                  className="text-xs text-blue-200 hover:text-white underline"
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
                className="px-3 py-1.5 rounded-md text-sm text-gray-800 bg-white border border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <button
              onClick={applyDates}
              disabled={!startDate || !endDate || !!dateError}
              className="px-4 py-1.5 text-sm font-semibold bg-white text-blue-700 rounded-md hover:bg-blue-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Apply
            </button>
            {(startDate || endDate) && (
              <button
                onClick={clearDates}
                className="px-3 py-1.5 text-sm text-blue-100 hover:text-white border border-blue-300 hover:border-white rounded-md transition-colors"
              >
                Clear
              </button>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[1, 7, 15, 30].map(days => (
              <button
                key={days}
                onClick={() => {
                  const start = getDateNDaysAgo(days);
                  setStartDate(start);
                  setEndDate(today);
                  setDateError('');
                }}
                className="px-2 py-0.5 text-xs rounded bg-blue-500 text-white hover:bg-blue-400 transition-colors"
              >
                Last {days}d
              </button>
            ))}
          </div>
          {dateError && (
            <p className="mt-2 text-sm text-red-200">{dateError}</p>
          )}
        </div>

        {hasDateMismatch && (
          <div className="px-6 py-2 bg-amber-50 border-b border-amber-200 text-sm text-amber-700">
            Note: closest available data used - showing {formatDate(data!.actual_start_date!)} - {formatDate(data!.actual_end_date!)}
          </div>
        )}

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

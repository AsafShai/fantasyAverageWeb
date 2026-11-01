import { useEffect, useState } from 'react'
import { useUrlState, enumParam, isoDateParam, stringParam } from '../hooks/useUrlState'
import { useGetRankingsQuery, useGetLeagueSummaryQuery, useGetRankChangesQuery } from '../store/api/fantasyApi'
import { usePersistedState } from '../hooks/usePersistedState'
import { Link } from 'react-router'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import { getErrorMessage } from '../utils/errorMessage'
import DataDateBadge from '../components/DataDateBadge'
import EspnUpdatedNote from '../components/EspnUpdatedNote'
import type { RankingStats, TeamRankChange } from '../types/api'
import { todayIso, getDateNDaysAgo, validateDateRange } from '../utils/dateRange'
import { MyTeamMark } from '../components/MyTeamMark'
import { useMyTeam } from '../context/MyTeamContext'
import { TEAM_NAME_BOX_CLASS, TEAM_NAME_CELL_CLASS, wrapFriendlyName } from '../utils/wrapName'
import { ShareCardButton } from '../components/share/ShareCardButton'
import { RankingsShareCard } from '../components/share/RankingsShareCard'
import { formatAsOf } from '../components/share/shareCardFormat'
import { orderCategories } from '../utils/statOrder'

const formatDate = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

const PERCENTAGE_CATEGORIES = new Set(['FG%', 'FT%'])

// Matches the heatmap's category-cell formatting (Analytics.tsx) so the same
// stat reads identically in both places: 4 decimal places, percentages scaled to 0-100.
const formatAverageValue = (categoryKey: string, val: number) =>
  PERCENTAGE_CATEGORIES.has(categoryKey) ? (val * 100).toFixed(4) + '%' : val.toFixed(4)

const formatDelta = (n: number) => (n % 1 === 0 ? Math.abs(n).toString() : Math.abs(n).toFixed(1))

// Hangs off the right edge of its value, so values keep a straight column.
const DELTA_CLASS = 'absolute left-full top-1/2 -translate-y-1/2 ml-1 text-[10px] leading-none'

/** ▲/▼ change since the previous night, small beside a number; `showSame`
 * prints a dash for no change (rank and total), otherwise nothing is shown. */
const Delta = ({ value, showSame = false }: { value: number | null | undefined; showSame?: boolean }) => {
  if (value == null) return null
  if (value > 0) return <span className={`${DELTA_CLASS} font-bold text-emerald-600 dark:text-emerald-400`}>▲{formatDelta(value)}</span>
  if (value < 0) return <span className={`${DELTA_CLASS} font-bold text-red-600 dark:text-red-400`}>▼{formatDelta(value)}</span>
  return showSame ? <span className={`${DELTA_CLASS} text-gray-400`}>–</span> : null
}

const RANKINGS_URL_SCHEMA = {
  from: isoDateParam(),
  to: isoDateParam(),
  mode: enumParam(['averages', 'totals'] as const, 'averages'),
  view: enumParam(['standings', 'rankings'] as const, 'rankings'),
  sort: stringParam('total_points'),
  order: enumParam(['asc', 'desc'] as const, 'desc'),
}

const Rankings = () => {
  const { isMyTeam, myTeamId } = useMyTeam()
  const [urlState, setUrlState] = useUrlState(RANKINGS_URL_SCHEMA)
  const hasUrlRange = urlState.from !== '' && urlState.to !== '' && urlState.from < urlState.to
  const [sortBy, setSortBy] = useState<string>(urlState.sort)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(urlState.order)
  const [mode, setMode] = useState<'averages' | 'totals'>(urlState.mode)
  const [viewMode, setViewMode] = useState<'standings' | 'rankings'>(urlState.view)
  const [startDate, setStartDate] = useState<string>(hasUrlRange ? urlState.from : '')
  const [endDate, setEndDate] = useState<string>(hasUrlRange ? urlState.to : '')
  const [dateError, setDateError] = useState<string>('')
  const [appliedDates, setAppliedDates] = useState<{ startDate?: string; endDate?: string }>(() =>
    hasUrlRange ? { startDate: urlState.from, endDate: urlState.to } : {}
  )

  useEffect(() => {
    setUrlState({
      from: appliedDates.startDate ?? '',
      to: appliedDates.endDate ?? '',
      mode,
      view: viewMode,
      sort: sortBy,
      order: sortOrder,
    })
  }, [setUrlState, appliedDates, mode, viewMode, sortBy, sortOrder])

  const today = todayIso()

  const { data, error, isLoading } = useGetRankingsQuery(appliedDates)
  const { data: summary, isLoading: summaryLoading } = useGetLeagueSummaryQuery()
  // Last night's moves belong to the default (season-to-date) view only.
  const [showMoves, setShowMoves] = usePersistedState('rankings.showMoves', true)
  const isDateRangeActive = !!(appliedDates.startDate && appliedDates.endDate)
  const { data: rankChanges } = useGetRankChangesQuery(mode, { skip: isDateRangeActive })

  const handleStartDate = (val: string) => {
    setStartDate(val)
    validateDates(val, endDate)
  }

  const handleEndDate = (val: string) => {
    setEndDate(val)
    validateDates(startDate, val)
  }

  const validateDates = (start: string, end: string) => {
    setDateError(validateDateRange(start, end, summary?.season_start, today) ?? '')
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
  // A custom-range failure (e.g. no data for that window) shouldn't blow away
  // the whole page — the date controls and default-season data stay usable;
  // only a failure on the default (no range) query is page-fatal.
  if (error && !isDateRangeActive) return <ErrorMessage message={getErrorMessage(error, 'Failed to load rankings')} />

  const rawRankings = mode === 'averages'
    ? (data?.averages_rankings || [])
    : (data?.totals_rankings || [])

  // This league's actual scoring categories (e.g. FG%, FT%, 3PM, ... or
  // whatever ESPN's league settings resolve to — see backend
  // resolve_ranking_categories), put in the app-wide stat order. TOTAL_POINTS
  // is handled separately as the fixed "Total" column.
  const categoryKeys = orderCategories((data?.categories || []).filter(c => c !== 'TOTAL_POINTS'))

  const getSortValue = (team: RankingStats) => {
    if (categoryKeys.includes(sortBy)) {
      return viewMode === 'rankings' ? team.category_ranks?.[sortBy] : team.stats?.[sortBy]
    }
    return team[sortBy as keyof RankingStats]
  }

  const rankings = [...rawRankings].sort((a, b) => {
    const aValue = getSortValue(a)
    const bValue = getSortValue(b)
    if (typeof aValue === 'number' && typeof bValue === 'number') {
      return sortOrder === 'asc' ? aValue - bValue : bValue - aValue
    }
    const aTeamName = a.team.team_name.toLowerCase()
    const bTeamName = b.team.team_name.toLowerCase()
    if (aTeamName < bTeamName) return sortOrder === 'asc' ? -1 : 1
    if (aTeamName > bTeamName) return sortOrder === 'asc' ? 1 : -1
    return 0
  })

  const isStandings = viewMode === 'standings'

  const hasMoves = !isDateRangeActive && (rankChanges?.teams.length ?? 0) > 0
  const movesShown = hasMoves && showMoves
  const movesByTeam = new Map<number, TeamRankChange>(
    movesShown ? rankChanges!.teams.map(t => [t.team_id, t]) : []
  )

  const columns = [
    { key: 'rank', label: 'Rank', sortable: true },
    { key: 'team', label: 'Team', sortable: true },
    ...categoryKeys.map(key => ({ key, label: key, sortable: true })),
    { key: 'total_points', label: 'Total', sortable: true },
    { key: 'gp', label: 'GP', sortable: true },
  ]

  const titleWord = isStandings ? 'Standings' : 'Rankings'
  const modeLabel = mode === 'averages' ? 'Averages' : 'Totals'

  const hasDateMismatch = data && isDateRangeActive && (
    (data.actual_start_date && data.actual_start_date !== data.date_range_start) ||
    (data.actual_end_date && data.actual_end_date !== data.date_range_end)
  )

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {(data?.data_date || summary?.espn_updated_at) && (
        <div className="mb-4 flex justify-end">
          {data?.data_date
            ? <DataDateBadge dataDate={data.data_date} />
            : <EspnUpdatedNote updatedAt={summary?.espn_updated_at} />}
        </div>
      )}
      {summary && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:flex sm:justify-center sm:gap-4">
          <div className="flex flex-col items-center gap-2 bg-white dark:bg-gray-800 px-3 py-2 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 hover:shadow-md transition-shadow sm:flex-row sm:gap-3 sm:px-5 sm:py-3">
            <div className="flex items-center justify-center w-8 h-8 bg-amber-100 rounded-full sm:w-10 sm:h-10">
              <span className="text-lg sm:text-xl">⚡</span>
            </div>
            <div className="text-center sm:text-left">
              <div className="text-xs text-gray-500 font-medium">NBA Avg Pace</div>
              <div className="text-xl font-bold text-gray-900 sm:text-2xl">{summary.nba_avg_pace == null ? '—' : summary.nba_avg_pace.toFixed(1)}</div>
            </div>
          </div>
          <div className="flex flex-col items-center gap-2 bg-white dark:bg-gray-800 px-3 py-2 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 hover:shadow-md transition-shadow sm:flex-row sm:gap-3 sm:px-5 sm:py-3">
            <div className="flex items-center justify-center w-8 h-8 bg-emerald-100 rounded-full sm:w-10 sm:h-10">
              <span className="text-lg sm:text-xl">📅</span>
            </div>
            <div className="text-center sm:text-left">
              <div className="text-xs text-gray-500 font-medium">Days Remaining</div>
              <div className="text-xl font-bold text-gray-900 sm:text-2xl">{summary.nba_game_days_left ?? 0}</div>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-600 to-blue-700 rounded-t-lg">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-2xl font-bold text-white">
                  Team {titleWord} ({modeLabel})
                  {isDateRangeActive && (
                    <span className="ml-2 text-lg font-normal text-blue-100">
                      – {formatDate(appliedDates.startDate!)} - {formatDate(appliedDates.endDate!)}
                    </span>
                  )}
                </h2>
                {rankings.length > 0 && (
                  <div className="shrink-0">
                    <ShareCardButton
                      title={isStandings ? 'Roto Standings' : 'Roto Rankings'}
                      variant="onBlue"
                      highlightOption={myTeamId !== null}
                      renderCard={({ dark, highlightMyTeam }) => (
                        <RankingsShareCard
                          dark={dark}
                          rows={rankings}
                          categories={categoryKeys}
                          view={viewMode}
                          mode={mode}
                          rangeLabel={isDateRangeActive ? `${formatDate(appliedDates.startDate!)} – ${formatDate(appliedDates.endDate!)}` : undefined}
                          asOf={formatAsOf(data?.data_date)}
                          highlightTeamId={highlightMyTeam ? myTeamId : null}
                          moves={movesShown ? movesByTeam : undefined}
                        />
                      )}
                    />
                  </div>
                )}
              </div>
              <p className="text-blue-100 mt-1">
                {isStandings
                  ? `${mode === 'averages' ? 'Per-game averages' : 'Season totals'}, exactly as ESPN reports them. Rank and Total still reflect roto scoring.`
                  : 'Each category cell shows the team\'s rank within that category. Click column headers to sort.'}
                {hasMoves && ' ▲/▼ = change since last night, GP + = games played last night.'}
              </p>
            </div>
            <div className="flex flex-col items-start sm:items-end gap-2 shrink-0">
              <div className="flex flex-col gap-1 items-start sm:items-end">
                <span className="text-xs font-semibold uppercase tracking-wide text-blue-100">View Mode</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setViewMode('standings')}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                      isStandings
                        ? 'bg-white text-blue-700'
                        : 'bg-blue-500 text-white hover:bg-blue-400'
                    }`}
                  >
                    Standings
                  </button>
                  <button
                    onClick={() => setViewMode('rankings')}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                      !isStandings
                        ? 'bg-white text-blue-700'
                        : 'bg-blue-500 text-white hover:bg-blue-400'
                    }`}
                  >
                    Rankings
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-1 items-start sm:items-end">
                <span className="text-xs font-semibold uppercase tracking-wide text-blue-100">Values</span>
                <div className="flex gap-2">
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
                className="px-3 py-1.5 rounded-md text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-700 border border-blue-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-300"
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
                className="px-3 py-1.5 rounded-md text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-700 border border-blue-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <button
              onClick={applyDates}
              disabled={!startDate || !endDate || !!dateError}
              className="px-4 py-1.5 text-sm font-semibold bg-white dark:bg-gray-700 text-blue-700 dark:text-blue-300 rounded-md hover:bg-blue-50 dark:hover:bg-gray-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
            {hasMoves && (
              <button
                onClick={() => setShowMoves(!showMoves)}
                className="ml-auto inline-flex w-36 items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-md transition-colors bg-white text-blue-700 hover:bg-blue-50"
              >
                <span aria-hidden="true" className="text-[10px] leading-none">
                  <span className="text-emerald-600">▲</span><span className="text-red-600">▼</span>
                </span>
                {showMoves ? 'Hide movers' : 'Show movers'}
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
          <div className="px-6 py-2 bg-amber-50 dark:bg-gray-700 border-b border-amber-200 dark:border-gray-600 text-sm text-amber-700 dark:text-amber-300">
            Note: closest available data used - showing {formatDate(data!.actual_start_date!)} - {formatDate(data!.actual_end_date!)}
          </div>
        )}

        {error && isDateRangeActive && (
          <div className="px-6 py-2 bg-red-50 dark:bg-red-900/30 border-b border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
            {getErrorMessage(error, 'Could not load rankings for this date range.')}
          </div>
        )}

        <div className="overflow-auto max-h-[70vh]">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="sticky top-0 z-30 bg-gray-50">
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    className={`table-header ${
                      column.sortable ? 'cursor-pointer hover:bg-gray-100 transition-colors duration-150' : ''
                    } ${column.key === 'gp' ? 'border-l-2 border-gray-300' : ''} ${column.key === 'rank' ? 'px-3 sm:px-6' : ''} ${
                      column.key === 'team' ? 'px-3 sm:px-6 sticky left-0 z-20 bg-gray-50 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]' : ''
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
              {rankings.map((team: RankingStats, index: number) => (
                <tr key={team.team.team_id} className="group hover:bg-blue-50 transition-colors duration-150 border-b border-gray-100">
                  <td className="table-cell px-3 sm:px-6 font-bold text-blue-600">
                    <span className="relative">
                      #{team.rank || index + 1}
                      <Delta value={movesByTeam.get(team.team.team_id)?.rank_delta} showSame />
                    </span>
                  </td>
                  <td className={`table-cell ${TEAM_NAME_CELL_CLASS} sticky left-0 z-10 bg-white group-hover:bg-blue-50 ${isMyTeam(team.team.team_id) ? 'shadow-[inset_4px_0_0_0_#2563eb,2px_0_4px_-2px_rgba(0,0,0,0.15)]' : 'shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]'}`}>
                    <div className={TEAM_NAME_BOX_CLASS}>
                      <Link
                        to={`/team/${team.team.team_id}`}
                        className="text-blue-600 hover:text-blue-800 font-semibold transition-colors duration-150 hover:underline"
                      >
                        {wrapFriendlyName(team.team.team_name)}
                      </Link>
                      <MyTeamMark teamId={team.team.team_id} />
                    </div>
                  </td>
                  {columns.slice(2).map((column) => {
                    const move = movesByTeam.get(team.team.team_id)
                    const isCategoryColumn = categoryKeys.includes(column.key)
                    const value = isCategoryColumn
                      ? (isStandings ? team.stats?.[column.key] : team.category_ranks?.[column.key])
                      : (team[column.key as keyof RankingStats] as number)

                    let display: string | number | undefined = value
                    if (typeof value === 'number') {
                      if (isCategoryColumn && !isStandings) {
                        display = value
                      } else if (isCategoryColumn && isStandings && mode === 'averages') {
                        display = formatAverageValue(column.key, value)
                      } else if (column.key === 'gp') {
                        display = value
                      } else {
                        display = value % 1 === 0 ? value.toString() : value.toFixed(1)
                      }
                    }

                    return (
                      <td key={column.key} className={`table-cell font-medium ${column.key === 'gp' ? 'border-l-2 border-gray-300' : ''}`}>
                        <span className="relative">
                          {display}
                          {move && isCategoryColumn && !isStandings && <Delta value={move.categories[column.key]} />}
                          {move && column.key === 'total_points' && <Delta value={move.total_delta} showSame />}
                          {move && column.key === 'gp' && move.gp_delta != null && (
                            <span className={`${DELTA_CLASS} text-gray-500 dark:text-gray-400`}>+{move.gp_delta}</span>
                          )}
                        </span>
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

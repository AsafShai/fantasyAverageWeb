import { useEffect, useState } from 'react'
import { useUrlState, enumParam, isoDateParam, stringParam } from '../hooks/useUrlState'
import { useLiveQuery } from '../hooks/useLiveQuery'
import { averagesNote } from '../utils/live'
import { liveRangeNote, moversLegend } from '../utils/liveTonight'
import LiveRangeNote from '../components/live/LiveRangeNote'
import { useGetRankingsQuery, useGetLeagueSummaryQuery, useGetRankChangesQuery } from '../store/api/fantasyApi'
import { usePersistedState } from '../hooks/usePersistedState'
import { Link } from 'react-router'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import { getErrorMessage } from '../utils/errorMessage'
import DataDateBadge from '../components/DataDateBadge'
import LiveBadge from '../components/live/LiveBadge'
import type { RankingStats, TeamRankChange } from '../types/api'
import { todayIso, getDateNDaysAgo, validateDateRange } from '../utils/dateRange'
import { MyTeamMark } from '../components/MyTeamMark'
import { useMyTeam } from '../context/MyTeamContext'
import { TEAM_NAME_BOX_CLASS, TEAM_NAME_CELL_CLASS, wrapFriendlyName } from '../utils/wrapName'
import { ShareCardButton } from '../components/share/ShareCardButton'
import { RankingsShareCard } from '../components/share/RankingsShareCard'
import { formatAsOf } from '../components/share/shareCardFormat'
import { orderCategories } from '../utils/statOrder'
import { useMobileRedesign } from '../mobile/flag'
import { RankingsMobile } from '../mobile/pages/rankings/RankingsMobile'

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

/** Inline mover deltas for card layout (avoids overflow from absolute positioning). */
const InlineDelta = ({ value, showSame = false }: { value: number | null | undefined; showSame?: boolean }) => {
  if (value == null) return null
  if (value > 0) return <span className="ml-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">▲{formatDelta(value)}</span>
  if (value < 0) return <span className="ml-0.5 text-[10px] font-bold text-red-600 dark:text-red-400">▼{formatDelta(value)}</span>
  return showSame ? <span className="ml-0.5 text-[10px] text-gray-400">–</span> : null
}

type RankingsCellContext = {
  categoryKeys: string[]
  isStandings: boolean
  mode: 'averages' | 'totals'
}

function getRankingCellDisplay(
  team: RankingStats,
  columnKey: string,
  ctx: RankingsCellContext,
): string | number | undefined {
  const { categoryKeys, isStandings, mode } = ctx
  const isCategoryColumn = categoryKeys.includes(columnKey)
  const value = isCategoryColumn
    ? (isStandings ? team.stats?.[columnKey] : team.category_ranks?.[columnKey])
    : (team[columnKey as keyof RankingStats] as number)

  if (typeof value !== 'number') return value

  if (isCategoryColumn && !isStandings) return value
  if (isCategoryColumn && isStandings && mode === 'averages') return formatAverageValue(columnKey, value)
  if (columnKey === 'gp') return value
  return value % 1 === 0 ? value.toString() : value.toFixed(1)
}

const RANKINGS_URL_SCHEMA = {
  from: isoDateParam(),
  to: isoDateParam(),
  mode: enumParam(['averages', 'totals'] as const, 'averages'),
  view: enumParam(['standings', 'rankings'] as const, 'rankings'),
  sort: stringParam('total_points'),
  order: enumParam(['asc', 'desc'] as const, 'desc'),
}

/** Shared size for header segment toggles (Layout / Show / Values): equal columns, same height */
const RANKINGS_HEADER_TOGGLE_ROW = 'grid grid-cols-2 gap-2 w-full min-w-[min(100%,11rem)] max-w-[22rem]'
const RANKINGS_HEADER_TOGGLE_BTN =
  'flex h-10 min-h-10 w-full items-center justify-center gap-1 rounded-lg px-2 text-center text-sm font-semibold leading-tight transition-colors sm:px-3'
/** Date pickers: same height and corner radius as toggle buttons; sits in the same grid width as toggles */
const RANKINGS_DATE_LABEL_ROW = 'flex min-h-5 items-center gap-2'
const RANKINGS_DATE_INPUT =
  'box-border h-10 min-h-10 w-full rounded-lg border border-blue-300 bg-white px-2 py-0 text-sm font-semibold leading-none text-gray-800 [color-scheme:light] focus:outline-none focus:ring-2 focus:ring-blue-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:[color-scheme:dark]'

const Rankings = () => {
  const { isMyTeam, myTeamId } = useMyTeam()
  const mobile = useMobileRedesign()
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

  const { data, error, isLoading } = useLiveQuery(useGetRankingsQuery, appliedDates)
  const { data: summary, isLoading: summaryLoading } = useGetLeagueSummaryQuery()
  // Last night's moves belong to the default (season-to-date) view only.
  const [showMoves, setShowMoves] = usePersistedState('rankings.showMoves', true)
  const [layout, setLayout] = usePersistedState<'cards' | 'table'>('rankings.layout', 'table')
  const showCards = layout === 'cards'
  const showTable = layout === 'table'
  const isDateRangeActive = !!(appliedDates.startDate && appliedDates.endDate)
  // While tonight is live these are tonight's moves (decision 7), so they poll with it.
  const { data: rankChanges } = useLiveQuery(useGetRankChangesQuery, mode, { skip: isDateRangeActive })

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

  const cellCtx: RankingsCellContext = { categoryKeys, isStandings, mode }

  const titleWord = isStandings ? 'Standings' : 'Rankings'
  const modeLabel = mode === 'averages' ? 'Averages' : 'Totals'

  const hasDateMismatch = data && isDateRangeActive && (
    (data.actual_start_date && data.actual_start_date !== data.date_range_start) ||
    (data.actual_end_date && data.actual_end_date !== data.date_range_end)
  )

  const rangeLabel = isDateRangeActive ? `${formatDate(appliedDates.startDate!)} – ${formatDate(appliedDates.endDate!)}` : ''

  const liveNote = averagesNote(data?.live, mode)
  // A range that ends today: its live note replaces the "closest available data" one.
  const rangeNote = isDateRangeActive ? liveRangeNote(data?.live, data?.actual_start_date, data?.actual_end_date) : null
  const legend = moversLegend(rankChanges?.live)

  const shareButton = (variant: 'onBlue' | 'neutral') => rankings.length > 0 && (
    <ShareCardButton
      title={isStandings ? 'Roto Standings' : 'Roto Rankings'}
      variant={variant}
      highlightOption={myTeamId !== null}
      renderCard={({ dark, highlightMyTeam }) => (
        <RankingsShareCard
          dark={dark}
          rows={rankings}
          categories={categoryKeys}
          view={viewMode}
          mode={mode}
          rangeLabel={rangeLabel || undefined}
          asOf={formatAsOf(data?.data_date)}
          highlightTeamId={highlightMyTeam ? myTeamId : null}
          moves={movesShown ? movesByTeam : undefined}
          live={data?.live}
        />
      )}
    />
  )

  if (mobile) {
    // Phone view: same state, data and controls, laid out for a phone.
    const explainer = isStandings
      ? `${mode === 'averages' ? 'Per-game averages' : 'Season totals'}, exactly as ESPN reports them. Rank and Total still reflect roto scoring.`
      : (showCards
        ? 'Each category shows the team\'s rank within that category. Use Sort below to reorder.'
        : 'Each category cell shows the team\'s rank within that category. Tap column headers to sort.')
        + (hasMoves ? ` ${legend}` : '')
    return (
      <RankingsMobile
        title={`Team ${titleWord} (${modeLabel})`}
        explainer={explainer}
        dataDate={data?.data_date}
        espnUpdatedAt={summary?.espn_updated_at}
        live={data?.live}
        liveNote={averagesNote(data?.live, mode, true)}
        share={shareButton('neutral')}
        layout={layout}
        onLayout={setLayout}
        view={viewMode}
        onView={setViewMode}
        mode={mode}
        onMode={setMode}
        startDate={startDate}
        endDate={endDate}
        minDate={summary?.season_start}
        today={today}
        dateError={dateError}
        onStartDate={handleStartDate}
        onEndDate={handleEndDate}
        onApply={applyDates}
        onClear={clearDates}
        onQuickRange={(days) => {
          setStartDate(getDateNDaysAgo(days))
          setEndDate(today)
          setDateError('')
        }}
        appliedRangeLabel={rangeLabel}
        mismatchNote={rangeNote ?? (hasDateMismatch
          ? `Note: closest available data used - showing ${formatDate(data!.actual_start_date!)} - ${formatDate(data!.actual_end_date!)}`
          : undefined)}
        rangeError={error && isDateRangeActive ? getErrorMessage(error, 'Could not load rankings for this date range.') : undefined}
        hasMoves={hasMoves}
        showMoves={showMoves}
        onToggleMoves={() => setShowMoves(!showMoves)}
        pace={summary?.nba_avg_pace}
        daysLeft={summary?.nba_game_days_left}
        rankings={rankings}
        categoryKeys={categoryKeys}
        movesByTeam={movesByTeam}
        cellDisplay={(t, key) => getRankingCellDisplay(t, key, cellCtx)}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSort={handleSort}
        onSortBy={handleSort}
        onToggleOrder={() => setSortOrder(o => (o === 'asc' ? 'desc' : 'asc'))}
        isMyTeam={isMyTeam}
      />
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {(data?.data_date || summary?.espn_updated_at || data?.live?.active) && (
        <div className="mb-4 flex justify-end">
          {data?.data_date
            ? <DataDateBadge dataDate={data.data_date} />
            : <LiveBadge live={data?.live} espnUpdatedAt={summary?.espn_updated_at} />}
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
          <div className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div className="min-w-0 flex-1">
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
                      {shareButton('onBlue')}
                    </div>
                  )}
                </div>
                <p className="text-blue-100 mt-1">
                  {isStandings
                    ? `${mode === 'averages' ? 'Per-game averages' : 'Season totals'}, exactly as ESPN reports them. Rank and Total still reflect roto scoring.`
                    : showCards
                      ? 'Each category shows the team\'s rank within that category. Use Sort below to reorder.'
                      : 'Each category cell shows the team\'s rank within that category. Click column headers to sort.'}
                  {hasMoves && ` ${legend}`}
                </p>
                {liveNote && (
                  <p className="mt-2 inline-block rounded-md border border-blue-400 bg-blue-900 px-3 py-1.5 text-sm text-white">{liveNote}</p>
                )}
              </div>
            </div>

            <div className="flex w-full max-w-full flex-col gap-3 sm:flex-row sm:items-end sm:gap-4 md:gap-6">
              <div className="flex min-w-0 w-full flex-1 flex-col gap-1 items-start" role="group" aria-label="Layout">
                <span className="text-xs font-semibold uppercase tracking-wide text-blue-100">Layout</span>
                <div className={`${RANKINGS_HEADER_TOGGLE_ROW} sm:max-w-none`}>
                  <button
                    type="button"
                    onClick={() => setLayout('table')}
                    className={`${RANKINGS_HEADER_TOGGLE_BTN} ${
                      showTable
                        ? 'bg-white text-blue-700'
                        : 'bg-blue-500 text-white hover:bg-blue-400'
                    }`}
                  >
                    Full table
                  </button>
                  <button
                    type="button"
                    onClick={() => setLayout('cards')}
                    className={`${RANKINGS_HEADER_TOGGLE_BTN} ${
                      showCards
                        ? 'bg-white text-blue-700'
                        : 'bg-blue-500 text-white hover:bg-blue-400'
                    }`}
                  >
                    Team cards
                  </button>
                </div>
              </div>
              <div className="flex min-w-0 w-full flex-1 flex-col gap-1 items-start" role="group" aria-label="Show">
                <span className="text-xs font-semibold uppercase tracking-wide text-blue-100">Show</span>
                <div className={`${RANKINGS_HEADER_TOGGLE_ROW} sm:max-w-none`}>
                  <button
                    type="button"
                    onClick={() => setViewMode('standings')}
                    className={`${RANKINGS_HEADER_TOGGLE_BTN} ${
                      isStandings
                        ? 'bg-white text-blue-700'
                        : 'bg-blue-500 text-white hover:bg-blue-400'
                    }`}
                  >
                    Standings
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('rankings')}
                    className={`${RANKINGS_HEADER_TOGGLE_BTN} ${
                      !isStandings
                        ? 'bg-white text-blue-700'
                        : 'bg-blue-500 text-white hover:bg-blue-400'
                    }`}
                  >
                    Rankings
                  </button>
                </div>
              </div>
              <div className="flex min-w-0 w-full flex-1 flex-col gap-1 items-start">
                <span className="text-xs font-semibold uppercase tracking-wide text-blue-100">Values</span>
                <div className={`${RANKINGS_HEADER_TOGGLE_ROW} sm:max-w-none`}>
                  <button
                    type="button"
                    onClick={() => setMode('averages')}
                    className={`${RANKINGS_HEADER_TOGGLE_BTN} ${
                      mode === 'averages'
                        ? 'bg-white text-blue-700'
                        : 'bg-blue-500 text-white hover:bg-blue-400'
                    }`}
                  >
                    Averages
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('totals')}
                    className={`${RANKINGS_HEADER_TOGGLE_BTN} ${
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

            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 flex-col gap-2 sm:max-w-md sm:flex-1">
                  <div className={RANKINGS_HEADER_TOGGLE_ROW}>
                    <div className="flex min-w-0 flex-col gap-1">
                      <label className={`${RANKINGS_DATE_LABEL_ROW} text-xs text-blue-100 font-medium`}>
                        <span>From</span>
                      </label>
                      <input
                        type="date"
                        value={startDate}
                        min={summary?.season_start}
                        max={endDate || today}
                        onChange={(e) => handleStartDate(e.target.value)}
                        className={RANKINGS_DATE_INPUT}
                      />
                    </div>
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className={`${RANKINGS_DATE_LABEL_ROW} justify-between`}>
                        <label htmlFor="rankings-date-to" className="text-xs text-blue-100 font-medium">
                          To
                        </label>
                        <button
                          type="button"
                          onClick={() => handleEndDate(today)}
                          className="text-[11px] font-medium text-blue-100 hover:text-white"
                        >
                          Today
                        </button>
                      </div>
                      <input
                        id="rankings-date-to"
                        type="date"
                        value={endDate}
                        min={startDate || summary?.season_start}
                        max={today}
                        onChange={(e) => handleEndDate(e.target.value)}
                        className={RANKINGS_DATE_INPUT}
                      />
                    </div>
                  </div>
                  {startDate && endDate && (
                    <div className={RANKINGS_HEADER_TOGGLE_ROW}>
                      <button
                        type="button"
                        onClick={applyDates}
                        disabled={!!dateError}
                        className="flex h-10 min-h-10 w-full items-center justify-center rounded-lg bg-white px-2 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gray-700 dark:text-blue-300 dark:hover:bg-gray-600 sm:px-3"
                      >
                        Apply
                      </button>
                      <button
                        type="button"
                        onClick={clearDates}
                        className="flex h-10 min-h-10 w-full items-center justify-center rounded-lg border border-blue-300 px-2 text-sm font-semibold text-blue-100 transition-colors hover:border-white hover:text-white sm:px-3"
                      >
                        Clear
                      </button>
                    </div>
                  )}
                </div>
                {hasMoves && (
                  <button
                    type="button"
                    onClick={() => setShowMoves(!showMoves)}
                    className="inline-flex shrink-0 items-center gap-1 self-end rounded-md border border-white/45 bg-white/15 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:border-white/70 hover:bg-white/25 active:bg-white/20 sm:self-start"
                  >
                    <span aria-hidden="true" className="text-[9px] leading-none">
                      <span className="text-emerald-200">▲</span>
                      <span className="text-red-200">▼</span>
                    </span>
                    {showMoves ? 'Hide movers' : 'Show movers'}
                  </button>
                )}
              </div>
              <div className="mt-1 w-full min-w-0 max-w-md">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-blue-200/90">
                  Quick range
                </div>
                <div
                  className="grid w-full grid-cols-4 gap-1.5 sm:gap-2"
                  role="group"
                  aria-label="Quick date range presets"
                >
                  {[1, 7, 15, 30].map(days => (
                    <button
                      key={days}
                      type="button"
                      onClick={() => {
                        const start = getDateNDaysAgo(days);
                        setStartDate(start);
                        setEndDate(today);
                        setDateError('');
                      }}
                      title={`Last ${days} day${days === 1 ? '' : 's'} to today`}
                      aria-label={`Set date range to last ${days} days through today`}
                      className="flex min-h-9 min-w-0 items-center justify-center rounded-lg border border-white/35 bg-white/10 px-1 py-2 text-center text-[11px] font-semibold leading-none text-white shadow-sm transition-colors hover:border-white/55 hover:bg-white/20 active:bg-white/15 sm:min-h-10 sm:px-2 sm:text-xs"
                    >
                      <span className="sm:hidden" aria-hidden="true">
                        {days}d
                      </span>
                      <span className="hidden sm:inline">Last {days}d</span>
                    </button>
                  ))}
                </div>
              </div>
              {dateError && (
                <p className="text-sm text-red-200">{dateError}</p>
              )}
            </div>
          </div>
        </div>

        {rangeNote && <LiveRangeNote live={data?.live} text={rangeNote} />}
        {!rangeNote && hasDateMismatch && (
          <div className="px-6 py-2 bg-amber-50 dark:bg-gray-700 border-b border-amber-200 dark:border-gray-600 text-sm text-amber-700 dark:text-amber-300">
            Note: closest available data used - showing {formatDate(data!.actual_start_date!)} - {formatDate(data!.actual_end_date!)}
          </div>
        )}

        {error && isDateRangeActive && (
          <div className="px-6 py-2 bg-red-50 dark:bg-red-900/30 border-b border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
            {getErrorMessage(error, 'Could not load rankings for this date range.')}
          </div>
        )}

        {showCards ? (
          <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-900/50 px-4 py-3 space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <label htmlFor="rankings-mobile-sort" className="text-xs font-medium text-gray-600 dark:text-gray-400">
                  Sort by
                </label>
                <select
                  id="rankings-mobile-sort"
                  value={sortBy}
                  onChange={e => handleSort(e.target.value)}
                  className="w-full min-w-0 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                >
                  {columns
                    .filter(c => c.sortable)
                    .map(c => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => setSortOrder(o => (o === 'asc' ? 'desc' : 'asc'))}
                className="shrink-0 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                aria-label={sortOrder === 'asc' ? 'Sort ascending' : 'Sort descending'}
              >
                {sortOrder === 'asc' ? '↑ Asc' : '↓ Desc'}
              </button>
            </div>
          </div>
        ) : null}

        {showCards ? (
          <div className="-mx-4 max-h-[70vh] overflow-y-auto px-4 pb-4 pt-1 [scrollbar-width:thin]">
            <ul className="space-y-3">
              {rankings.map((teamRow: RankingStats, index: number) => {
                const move = movesByTeam.get(teamRow.team.team_id)
                const my = isMyTeam(teamRow.team.team_id)
                const totalVal = getRankingCellDisplay(teamRow, 'total_points', cellCtx)
                const gpVal = getRankingCellDisplay(teamRow, 'gp', cellCtx)
                return (
                  <li
                    key={teamRow.team.team_id}
                    className={`rounded-lg border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800 ${
                      my ? 'ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-gray-900' : ''
                    }`}
                  >
                    <div className="flex flex-wrap items-start gap-2 gap-y-1 border-b border-gray-100 pb-2 dark:border-gray-700">
                      <div className="shrink-0 text-sm font-bold text-blue-600">
                        <span className="inline-flex items-baseline">
                          #{teamRow.rank || index + 1}
                          <InlineDelta value={move?.rank_delta} showSame />
                        </span>
                      </div>
                      <div className={`min-w-0 flex-1 ${TEAM_NAME_CELL_CLASS}`}>
                        <div className={TEAM_NAME_BOX_CLASS}>
                          <Link
                            to={`/team/${teamRow.team.team_id}`}
                            className="text-sm font-semibold text-blue-600 hover:text-blue-800 hover:underline dark:text-blue-400 dark:hover:text-blue-300"
                          >
                            {wrapFriendlyName(teamRow.team.team_name)}
                          </Link>
                          <MyTeamMark teamId={teamRow.team.team_id} />
                        </div>
                      </div>
                      <div className="flex w-full shrink-0 justify-between gap-3 text-xs sm:w-auto sm:flex-col sm:items-end sm:justify-start">
                        <div className="text-right">
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Total</div>
                          <div className="inline-flex items-baseline font-semibold text-gray-900 dark:text-gray-100">
                            {totalVal}
                            {move && <InlineDelta value={move.total_delta} showSame />}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">GP</div>
                          <div className="inline-flex items-baseline font-semibold text-gray-900 dark:text-gray-100">
                            {gpVal}
                            {move && move.gp_delta != null && (
                              <span className="ml-0.5 text-[10px] text-gray-500 dark:text-gray-400">+{move.gp_delta}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-2">
                      {categoryKeys.map(catKey => {
                        const display = getRankingCellDisplay(teamRow, catKey, cellCtx)
                        const catDelta = move && !isStandings ? move.categories[catKey] : undefined
                        return (
                          <div
                            key={catKey}
                            className="rounded border border-gray-100 bg-gray-50/80 px-1.5 py-1 dark:border-gray-600 dark:bg-gray-900/40"
                          >
                            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{catKey}</div>
                            <div className="inline-flex flex-wrap items-baseline text-xs font-medium text-gray-900 dark:text-gray-100">
                              {display}
                              {catDelta !== undefined && <InlineDelta value={catDelta} />}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : (
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
                    const display = getRankingCellDisplay(team, column.key, cellCtx)

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
        )}
      </div>
    </div>
  )
}

export default Rankings

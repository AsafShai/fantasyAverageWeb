import { useEffect, useState } from 'react'
import { useUrlState, enumParam, isoDateParam, stringParam } from '../hooks/useUrlState'
import { useLiveQuery } from '../hooks/useLiveQuery'
import { averagesNote } from '../utils/live'
import { liveRangeNote, moversLegend, standingsMoversLegend } from '../utils/liveTonight'
import LiveRangeNote from '../components/live/LiveRangeNote'
import { useGetRankingsQuery, useGetLeagueSummaryQuery, useGetRankChangesQuery } from '../store/api/fantasyApi'
import { usePersistedState } from '../hooks/usePersistedState'
import { Link } from 'react-router'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import { getErrorMessage } from '../utils/errorMessage'
import DataDateBadge from '../components/DataDateBadge'
import LiveBadge from '../components/live/LiveBadge'
import type { CustomDateRange, RankingStats, TeamRankChange, TimePeriod } from '../types/api'
import { todayIso, getDateNDaysAgo, presetRangeStart, validateDateRange } from '../utils/dateRange'
import TimePeriodSelector from '../components/TimePeriodSelector'
import '../mobile/pages/playerRankings/playerRankings.css'
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

/** Raw stat added (Totals standings), grey like GP's "+n" so it never reads as a ▲/▼ move. Zero shows nothing. */
const formatStatAdded = (n: number) => `${n > 0 ? '+' : '−'}${formatDelta(n)}`

const StatAdded = ({ value }: { value: number | undefined }) => {
  if (value == null || value === 0) return null
  return <span className="ml-0.5 text-[10px] text-gray-500 dark:text-gray-400">{formatStatAdded(value)}</span>
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
  // A percentage is the same rate in totals mode, so it keeps the averages
  // formatting instead of collapsing to "0.5".
  if (isCategoryColumn && isStandings && (mode === 'averages' || PERCENTAGE_CATEGORIES.has(columnKey))) {
    return formatAverageValue(columnKey, value)
  }
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

/** Compact header toggles so the table can sit near the top of the page. */
const RANKINGS_HEADER_TOGGLE_BTN =
  'flex h-8 items-center justify-center rounded-md px-2.5 text-xs font-semibold leading-none transition-colors whitespace-nowrap'

const PERIOD_DAYS: Partial<Record<TimePeriod, number>> = { last_7: 7, last_15: 15, last_30: 30 }

const Rankings = () => {
  const { isMyTeam, myTeamId } = useMyTeam()
  const mobile = useMobileRedesign()
  const [urlState, setUrlState] = useUrlState(RANKINGS_URL_SCHEMA)
  const hasUrlRange = urlState.from !== '' && urlState.to !== '' && urlState.from <= urlState.to
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

  const applyRange = (start: string, end: string) => {
    const err = validateDateRange(start, end, summary?.season_start, today)
    setDateError(err ?? '')
    if (err) return
    setStartDate(start)
    setEndDate(end)
    setAppliedDates({ startDate: start, endDate: end })
  }

  const lastNightDate = summary?.data_date || getDateNDaysAgo(1)

  const handlePeriod = (period: TimePeriod) => {
    if (period === 'season') {
      clearDates()
      return
    }
    if (period === 'last_night') {
      setStartDate(lastNightDate)
      setEndDate(lastNightDate)
      setDateError('')
      setAppliedDates({ startDate: lastNightDate, endDate: lastNightDate })
      return
    }
    const days = PERIOD_DAYS[period]
    if (!days) return
    applyRange(presetRangeStart(days, summary?.season_start), today)
  }

  const handleCustomRange = (range: CustomDateRange | null) => {
    if (!range) {
      clearDates()
      return
    }
    applyRange(range.start, range.end)
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
  // Standings cells are raw stats: the ▲/▼ beside one is places moved in that
  // category (a roto point is a place), and in Totals a grey "+n" is the stat
  // added (PTS +118). Averages barely move, so no "+n" there.
  const showStatAdded = isStandings && mode === 'totals'
  // "4837 +125▼1" flows inline, so those columns take less padding to keep GP on screen.
  const compactCategoryCells = showStatAdded && movesShown

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
  const legend = isStandings
    ? standingsMoversLegend(rankChanges?.live, mode === 'totals')
    : moversLegend(rankChanges?.live)

  const activePeriod: TimePeriod = (() => {
    if (!appliedDates.startDate || !appliedDates.endDate) return 'season'
    if (appliedDates.startDate === appliedDates.endDate && appliedDates.startDate === lastNightDate) return 'last_night'
    if (appliedDates.endDate === today) {
      const match = (Object.keys(PERIOD_DAYS) as TimePeriod[]).find(
        (key) => appliedDates.startDate === presetRangeStart(PERIOD_DAYS[key]!, summary?.season_start),
      )
      if (match) return match
    }
    return 'custom'
  })()
  const customRange: CustomDateRange | null =
    activePeriod === 'custom' && appliedDates.startDate && appliedDates.endDate
      ? { start: appliedDates.startDate, end: appliedDates.endDate }
      : null

  const seasonStrip = summary ? (
    <div className="flex max-w-full flex-wrap items-center gap-1.5 normal-case tracking-normal">
      <div className="flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 py-0.5 pl-0.5 pr-2.5 dark:border-amber-600 dark:bg-amber-950">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-200 text-sm dark:bg-amber-800" aria-hidden="true">⚡</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">NBA Avg Pace</span>
        <span className="text-sm font-bold tabular-nums leading-none text-amber-950 dark:text-amber-50">
          {summary.nba_avg_pace == null ? '—' : summary.nba_avg_pace.toFixed(1)}
        </span>
      </div>
      <div className="flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 py-0.5 pl-0.5 pr-2.5 dark:border-emerald-600 dark:bg-emerald-950">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-200 text-sm dark:bg-emerald-800" aria-hidden="true">📅</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">Days Remaining</span>
        <span className="text-sm font-bold tabular-nums leading-none text-emerald-950 dark:text-emerald-50">
          {summary.nba_game_days_left ?? 0}
        </span>
      </div>
    </div>
  ) : null

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
    const explainer = (isStandings
      ? `${mode === 'averages' ? 'Per-game averages' : 'Season totals'}, exactly as ESPN reports them. Rank and Total still reflect roto scoring.`
      : (showCards
        ? 'Each category shows the team\'s rank within that category. Use Sort below to reorder.'
        : 'Each category cell shows the team\'s rank within that category. Tap column headers to sort.'))
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
          const start = presetRangeStart(days, summary?.season_start)
          setStartDate(start)
          setEndDate(today)
          validateDates(start, today)
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

  const onToggle = 'bg-[#ffffff] text-[#0f172a]'
  const offToggle = 'bg-blue-800/50 text-white hover:bg-blue-800/70'

  return (
    <div className="mx-auto min-w-0 max-w-7xl px-4 py-3 sm:px-6 lg:px-8">
      <div className="card min-w-0">
        <div className="rounded-t-lg border-b border-blue-800 bg-gradient-to-r from-blue-600 to-blue-700">
        <div className="flex min-w-0 flex-col gap-2 px-3 py-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="shrink-0 text-base font-bold text-white">
              Team {titleWord} ({modeLabel})
            </h2>
            <div className="inline-flex shrink-0 gap-1 rounded-lg bg-blue-800/40 p-0.5" role="group" aria-label="Layout">
              <button type="button" onClick={() => setLayout('table')} className={`${RANKINGS_HEADER_TOGGLE_BTN} ${showTable ? onToggle : offToggle}`}>
                Full table
              </button>
              <button type="button" onClick={() => setLayout('cards')} className={`${RANKINGS_HEADER_TOGGLE_BTN} ${showCards ? onToggle : offToggle}`}>
                Team cards
              </button>
            </div>
            <div className="inline-flex shrink-0 gap-1 rounded-lg bg-blue-800/40 p-0.5" role="group" aria-label="Show">
              <button type="button" onClick={() => setViewMode('standings')} className={`${RANKINGS_HEADER_TOGGLE_BTN} ${isStandings ? onToggle : offToggle}`}>
                Standings
              </button>
              <button type="button" onClick={() => setViewMode('rankings')} className={`${RANKINGS_HEADER_TOGGLE_BTN} ${!isStandings ? onToggle : offToggle}`}>
                Rankings
              </button>
            </div>
            <div className="inline-flex shrink-0 gap-1 rounded-lg bg-blue-800/40 p-0.5" role="group" aria-label="Values">
              <span className="sr-only">Values</span>
              <button type="button" onClick={() => setMode('averages')} className={`${RANKINGS_HEADER_TOGGLE_BTN} ${mode === 'averages' ? onToggle : offToggle}`}>
                Averages
              </button>
              <button type="button" onClick={() => setMode('totals')} className={`${RANKINGS_HEADER_TOGGLE_BTN} ${mode === 'totals' ? onToggle : offToggle}`}>
                Totals
              </button>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {shareButton('onBlue')}
              {(data?.data_date || summary?.espn_updated_at || data?.live?.active) && (
                data?.data_date
                  ? <DataDateBadge dataDate={data.data_date} />
                  : <LiveBadge live={data?.live} espnUpdatedAt={summary?.espn_updated_at} className="!text-blue-100" />
              )}
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="min-w-0 max-w-full [&_.pr-period]:max-w-full [&_.pr-period-btn]:!border-white/35 [&_.pr-period-btn]:!bg-blue-800/50 [&_.pr-period-btn]:!text-white [&_.pr-period-on]:!border-[#ffffff] [&_.pr-period-on]:!bg-[#ffffff] [&_.pr-period-on]:!text-[#0f172a]">
              <TimePeriodSelector
                appearance="plain"
                popover
                showLastNight
                value={activePeriod}
                onChange={handlePeriod}
                customRange={customRange}
                onCustomRangeChange={handleCustomRange}
              />
            </div>
            {hasMoves && (
              <button
                type="button"
                onClick={() => setShowMoves(!showMoves)}
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-white/45 bg-white/15 px-2.5 text-xs font-semibold text-white hover:bg-white/25"
              >
                <span aria-hidden="true" className="text-[9px] leading-none">
                  <span className="text-emerald-200">▲</span>
                  <span className="text-red-200">▼</span>
                </span>
                {showMoves ? 'Hide movers' : 'Show movers'}
              </button>
            )}
            <div className="ml-auto shrink-0">{seasonStrip}</div>
          </div>
        </div>
          {liveNote && (
            <p className="px-3 pb-2 text-xs text-blue-100">{liveNote}</p>
          )}
          {dateError && (
            <p className="px-3 pb-2 text-sm text-red-200">{dateError}</p>
          )}
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
                        const catDelta = move ? move.categories[catKey] : undefined
                        const statAdded = showStatAdded ? move?.stat_deltas?.[catKey] : undefined
                        return (
                          <div
                            key={catKey}
                            className="rounded border border-gray-100 bg-gray-50/80 px-1.5 py-1 dark:border-gray-600 dark:bg-gray-900/40"
                          >
                            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{catKey}</div>
                            <div className="inline-flex flex-wrap items-baseline text-xs font-medium text-gray-900 dark:text-gray-100">
                              {display}
                              <StatAdded value={statAdded} />
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
        <div className="max-w-full overflow-auto max-h-[70vh]">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="sticky top-0 z-30 bg-gray-50">
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    className={`table-header ${
                      column.sortable ? 'cursor-pointer hover:bg-gray-100 transition-colors duration-150' : ''
                    } ${column.key === 'gp' ? 'border-l-2 border-gray-300' : ''} ${column.key === 'rank' ? 'px-3 sm:px-6' : ''} ${
                      compactCategoryCells && categoryKeys.includes(column.key) ? 'sm:px-3' : ''
                    } ${
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
                      <td key={column.key} className={`table-cell font-medium ${column.key === 'gp' ? 'border-l-2 border-gray-300' : ''} ${compactCategoryCells && isCategoryColumn ? 'sm:px-3' : ''}`}>
                        <span className="relative">
                          {display}
                          {move && isCategoryColumn && (
                            // Totals standings: "+118▲1" is too wide to hang off the edge, so it flows inline.
                            <span className={showStatAdded ? 'ml-0.5 whitespace-nowrap' : `${DELTA_CLASS} whitespace-nowrap`}>
                              {showStatAdded && <StatAdded value={move.stat_deltas?.[column.key]} />}
                              <InlineDelta value={move.categories[column.key]} />
                            </span>
                          )}
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
        <p className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400">
          {isStandings
            ? `${mode === 'averages' ? 'Per-game averages' : 'Season totals'}, exactly as ESPN reports them. Rank and Total still reflect roto scoring.`
            : showCards
              ? 'Each category shows the team\'s rank within that category. Use Sort above to reorder.'
              : 'Each category cell shows the team\'s rank within that category. Click column headers to sort.'}
          {hasMoves && ` ${legend}`}
        </p>
      </div>
    </div>
  )
}

export default Rankings

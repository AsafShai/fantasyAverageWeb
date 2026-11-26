import { useState, useMemo, useRef, useEffect, useTransition, useDeferredValue } from 'react'
import { usePersistedState } from '../hooks/usePersistedState'
import { useWeightDraft } from '../hooks/useWeightDraft'
import { useGetAllPlayersQuery, useGetLatestMovesQuery, useGetTeamsListQuery } from '../store/api/fantasyApi'
import { useMyTeam } from '../context/MyTeamContext'
import LoadingSpinner from '../components/LoadingSpinner'
import { FantasyTeamMenu } from '../components/playerRankings/FantasyTeamMenu'
import { NbaTeamFilter } from '../components/playerRankings/NbaTeamFilter'
import { matchesNbaTeam, parseNbaTeams } from '../components/playerRankings/nbaTeams'
import ErrorMessage from '../components/ErrorMessage'
import { getErrorMessage } from '../utils/errorMessage'
import TimePeriodSelector from '../components/TimePeriodSelector'
import { CoverageNotice } from '../components/DateRangePicker'
import PlayerNameLink from '../components/PlayerNameLink'
import { formatShort } from '../utils/dateRange'
import { normalizePlayerName } from '../utils/playerName'
import { orderCategories } from '../utils/statOrder'
import InfoTip from '../components/InfoTip'
import { METRIC_GLOSSARY, type MetricInfo } from '../constants/metricGlossary'
import type { TimePeriod, CustomDateRange } from '../types/api'
import { useMobileRedesign } from '../mobile/flag'
import { PositionFilter } from '../mobile/ui'
import PlayerRankingsMobile from '../mobile/pages/playerRankings/PlayerRankingsMobile'
import '../mobile/pages/playerRankings/playerRankings.css'
import {
  matchesFantasyTeam,
  parseFantasyTeamFilter,
  type FantasyTeamFilter,
} from '../mobile/pages/playerRankings/filters'
import {
  computePlayerRankings,
  getRawValue,
  partitionByDataAvailability,
  DEFAULT_CATEGORIES,
  PERCENTAGE_CATEGORIES,
  CATEGORY_LABELS,
  type RankingCategory,
  type RankedPlayer,
  type RankingsConfig,
  matchesPositionFilter,
} from '../utils/playerRankings'

type SortCol = 'rank' | 'totalZ' | 'gp' | 'min' | RankingCategory | `${RankingCategory}_raw`

const DEFAULT_WEIGHTS = Object.fromEntries(DEFAULT_CATEGORIES.map(c => [c, 1])) as Record<RankingCategory, number>

const ALL_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C']

/** The old desktop control stored one position. Keep it when the multi-select has never been saved. */
function savedPositions(): string[] | undefined {
  try {
    if (localStorage.getItem('fw:playerRankings.positions') !== null) return undefined
    const single = JSON.parse(localStorage.getItem('fw:playerRankings.position') ?? 'null')
    return typeof single === 'string' && ALL_POSITIONS.includes(single) ? [single] : undefined
  } catch {
    return undefined
  }
}

/** Short fantasy code. team_id 0 is a free agent or on waivers. */
function fantasyTeamAbbrev(teamId: number, abbrevById: Map<number, string>): string {
  if (teamId === 0) return 'FA'
  return abbrevById.get(teamId) ?? '—'
}

/** Minutes follow the display mode (total or per game). Shown, never ranked. */
function minutesValue(ranked: RankedPlayer, displayMode: 'totals' | 'per_game'): number {
  const { minutes, gp } = ranked.player.stats
  if (displayMode === 'totals') return minutes
  return gp > 0 ? minutes / gp : 0
}

function getSortVal(ranked: RankedPlayer, col: SortCol, displayMode: 'totals' | 'per_game'): number {
  if (col === 'totalZ') return ranked.totalZ
  if (col === 'gp') return ranked.player.stats.gp
  if (col === 'min') return minutesValue(ranked, displayMode)
  if (col.endsWith('_raw')) return getRawValue(ranked.player, col.replace('_raw', '') as RankingCategory, displayMode)
  return ranked.zScores[col as RankingCategory]
}

export default function PlayerRankings() {
  const [period, setPeriod] = useState<TimePeriod>('season')
  const [customRange, setCustomRange] = useState<CustomDateRange | null>(null)
  const { data: playersData, isLoading, error } = useGetAllPlayersQuery({
    limit: 1200,
    time_period: period,
    ...(period === 'custom' && customRange ? { start: customRange.start, end: customRange.end } : {}),
  })
  const { data: teams, isSuccess: teamsLoaded } = useGetTeamsListQuery()
  const teamsHaveAbbrevs = (teams ?? []).some(team => team.abbrev)
  // The teams list carries the short code once the API includes it. Until then,
  // the activity feed's team list has the same codes.
  const { data: latestMoves } = useGetLatestMovesQuery(1, { skip: !teamsLoaded || teamsHaveAbbrevs })
  const { myTeamId, isMyTeam } = useMyTeam()
  const abbrevById = useMemo(() => {
    const map = new Map<number, string>()
    for (const team of teams ?? []) {
      if (team.abbrev) map.set(team.team_id, team.abbrev)
    }
    if (map.size === 0) {
      for (const team of latestMoves?.teams ?? []) {
        if (team.abbrev) map.set(team.team_id, team.abbrev)
      }
    }
    return map
  }, [teams, latestMoves])
  const allPlayers = useMemo(() => playersData?.players ?? [], [playersData])
  const { available: players, excluded: excludedPlayers } = useMemo(
    () => partitionByDataAvailability(allPlayers),
    [allPlayers]
  )
  // This league's actual scoring categories, from the API response — falls
  // back to the historical default 8 until the first response lands. Shown
  // in the app-wide stat order.
  const apiCategories = playersData?.categories
  const categories = useMemo(
    () => orderCategories(apiCategories?.length ? apiCategories : DEFAULT_CATEGORIES),
    [apiCategories]
  )
  const reverseCategories = useMemo(
    () => new Set(playersData?.reverse_categories ?? []),
    [playersData?.reverse_categories]
  )

  const [calcMode, setCalcMode] = usePersistedState<'totals' | 'per_game'>('playerRankings.calcMode', 'per_game')
  const [displayMode, setDisplayMode] = usePersistedState<'totals' | 'per_game'>('playerRankings.displayMode', 'per_game')
  const [minGp, setMinGp] = usePersistedState('playerRankings.minGp', 0)
  const [minMin, setMinMin] = usePersistedState('playerRankings.minMin', 0)
  const [positionsSeed] = useState(savedPositions)
  const [positionsPicked, setPositionsPicked] = usePersistedState<string[]>('playerRankings.positions', [], positionsSeed)
  const [nbaTeamsRaw, setNbaTeams] = usePersistedState<string[]>('playerRankings.nbaTeams', [])
  const nbaTeams = useMemo(() => parseNbaTeams(nbaTeamsRaw), [nbaTeamsRaw])
  useEffect(() => {
    if (nbaTeams.length !== nbaTeamsRaw.length) setNbaTeams(nbaTeams)
  }, [nbaTeams, nbaTeamsRaw, setNbaTeams])
  const [fantasyTeamRaw, setFantasyTeam] = usePersistedState<FantasyTeamFilter>('playerRankings.fantasyTeam', null)
  const fantasyTeam = useMemo(() => parseFantasyTeamFilter(fantasyTeamRaw), [fantasyTeamRaw])
  useEffect(() => {
    if (JSON.stringify(fantasyTeamRaw) !== JSON.stringify(fantasyTeam)) setFantasyTeam(fantasyTeam)
  }, [fantasyTeam, fantasyTeamRaw, setFantasyTeam])
  const [weights, setWeights] = usePersistedState<Record<RankingCategory, number>>('playerRankings.weights', { ...DEFAULT_WEIGHTS })
  // A persisted weights object from a previous session (or the default 8)
  // may be missing an entry for a category this league scores (e.g. TO) —
  // default any missing category to weight 1 rather than treating it as punted.
  const effectiveWeights = useMemo(() => {
    const merged = { ...weights }
    let changed = false
    for (const cat of categories) {
      if (!(cat in merged)) { merged[cat] = 1; changed = true }
    }
    return changed ? merged : weights
  }, [weights, categories])
  const [displayLimit, setDisplayLimit] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const resultsRef = useRef<HTMLDivElement>(null)
  const searchQuery = useMemo(() => normalizePlayerName(deferredSearch), [deferredSearch])
  const [sliderResetKey, setSliderResetKey] = useState(0)
  const [sortCol, setSortCol] = useState<SortCol>('totalZ')
  const [sortAsc, setSortAsc] = useState(false)
  const [rankedPlayers, setRankedPlayers] = useState<RankedPlayer[]>([])
  const [hasCalculated, setHasCalculated] = useState(false)
  const [, startTransition] = useTransition()
  const mobile = useMobileRedesign()

  useEffect(() => {
    if (period !== 'custom' || !customRange || excludedPlayers.length === 0) return
    console.warn(
      `${excludedPlayers.length} players excluded (no data for ${customRange.start}–${customRange.end}):`,
      excludedPlayers.map(p => p.player_name)
    )
  }, [period, customRange, excludedPlayers])

  const handleReset = () => {
    setCalcMode('per_game')
    setDisplayMode('per_game')
    setPeriod('season')
    setCustomRange(null)
    setMinGp(0)
    setMinMin(0)
    setPositionsPicked([])
    setNbaTeams([])
    setFantasyTeam(null)
    setWeights({ ...DEFAULT_WEIGHTS })
    setDisplayLimit(null)
    setSliderResetKey(k => k + 1)
  }

  const isPunted = (cat: RankingCategory) => effectiveWeights[cat] === 0

  const recompute = () => {
    const config: RankingsConfig = { calcMode, minGp, minMin, position: null, positions: [], weights: effectiveWeights }
    const next = computePlayerRankings(players, config, categories, reverseCategories)
    // Low-priority: if another slider tick (or anything urgent) comes in
    // while this 500-row re-render is in flight, React interrupts/discards
    // it instead of finishing it first — keeps the slider itself responsive.
    startTransition(() => {
      setRankedPlayers(next)
      setHasCalculated(true)
    })
  }

  const handleCalculate = () => {
    recompute()
    setSortCol('totalZ')
    setSortAsc(false)
  }

  useEffect(() => {
    if (players.length > 0) {
      // Ranks the newly loaded players (the heavy part runs in a transition).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      handleCalculate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players])

  // Live recompute as sliders/calc-mode change — no Calculate click needed.
  // `weights` only updates here once WeightSliders has already debounced a
  // drag internally, so this fires once per settled change, not per tick —
  // the 500-row table only re-renders once the slider actually stops moving.
  // Doesn't reset sortCol/sortAsc so an active sort survives a slider drag.
  useEffect(() => {
    if (players.length > 0 && hasCalculated) recompute()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weights, calcMode])

  const sortedPlayers = useMemo(() => {
    if (!rankedPlayers.length) return []
    const poolForRank = rankedPlayers.filter(r =>
      r.player.stats.gp >= minGp &&
      (r.player.stats.gp > 0 ? r.player.stats.minutes / r.player.stats.gp : 0) >= minMin
    )
    // rankedPlayers is already sorted by totalZ descending, so this keeps
    // "top N by rank" regardless of which column is currently sorted below.
    // The row number is the totalZ rank, so it stays with the player whichever
    // column the table is sorted by. It's taken before position, fantasy-team,
    // and NBA-team filters so a filtered player keeps his rank among the whole pool.
    // Search also runs after ranking, so a match keeps its overall rank, and it
    // ignores the Top-N limit — searching should find anyone in the pool.
    const withRank = poolForRank
      .map((ranked, idx) => ({ ranked, rank: idx + 1 }))
      .filter(r => matchesPositionFilter(r.ranked.player.positions, null, positionsPicked))
      .filter(r => matchesFantasyTeam(r.ranked.player.team_id, fantasyTeam))
      .filter(r => matchesNbaTeam(r.ranked.player.pro_team, nbaTeams))
      .filter(r => !searchQuery || normalizePlayerName(r.ranked.player.player_name).includes(searchQuery))
    const limited = displayLimit === null || searchQuery ? withRank : withRank.slice(0, displayLimit)
    return limited.sort((a, b) => {
      if (sortCol === 'rank') return sortAsc ? a.rank - b.rank : b.rank - a.rank
      const aVal = getSortVal(a.ranked, sortCol, displayMode)
      const bVal = getSortVal(b.ranked, sortCol, displayMode)
      return sortAsc ? aVal - bVal : bVal - aVal
    })
  }, [rankedPlayers, sortCol, sortAsc, minGp, minMin, positionsPicked, fantasyTeam, nbaTeams, displayMode, displayLimit, searchQuery])

  const handleSort = (col: SortCol) => {
    if (col === sortCol) setSortAsc(a => !a)
    // Rank 1 is best, so rank starts ascending; every other column starts high-to-low.
    else { setSortCol(col); setSortAsc(col === 'rank') }
  }

  const fmt = (n: number, decimals = 2) => n.toFixed(decimals)
  const fmtPct = (n: number) => (n * 100).toFixed(1) + '%'

  const rawDisplay = (ranked: RankedPlayer, cat: RankingCategory) => {
    const val = getRawValue(ranked.player, cat, displayMode)
    return PERCENTAGE_CATEGORIES.has(cat) ? fmtPct(val) : fmt(val, 1)
  }

  if (isLoading) return <LoadingSpinner />
  if (error) return <ErrorMessage message={getErrorMessage(error, 'Failed to load players.')} />

  if (mobile) {
    return (
      <PlayerRankingsMobile
        search={search}
        onSearchChange={setSearch}
        searchActive={!!searchQuery}
        hasCalculated={hasCalculated}
        rows={sortedPlayers}
        sortCol={sortCol}
        sortAsc={sortAsc}
        onSort={(col, asc) => { setSortCol(col as SortCol); setSortAsc(asc) }}
        calcMode={calcMode}
        onCalcMode={setCalcMode}
        displayMode={displayMode}
        onDisplayMode={setDisplayMode}
        period={period}
        onPeriod={setPeriod}
        customRange={customRange}
        onCustomRange={setCustomRange}
        actualStart={playersData?.actual_start}
        actualEnd={playersData?.actual_end}
        filters={{ positions: positionsPicked, setPositions: setPositionsPicked, nbaTeams, setNbaTeams, fantasyTeam, setFantasyTeam, displayLimit, setDisplayLimit, minGp, setMinGp, minMin, setMinMin }}
        teams={teams ?? []}
        myTeamId={myTeamId}
        isMyTeam={isMyTeam}
        categories={categories}
        weights={effectiveWeights}
        onWeights={setWeights}
        sliderResetKey={sliderResetKey}
        playersLoaded={players.length}
        onReset={handleReset}
        isPunted={isPunted}
        fantasyAbbrev={teamId => fantasyTeamAbbrev(teamId, abbrevById)}
        minutesText={ranked => ranked.player.stats.gp > 0 ? fmt(minutesValue(ranked, displayMode), displayMode === 'totals' ? 0 : 1) : '—'}
        rawText={rawDisplay}
      />
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div className="max-w-screen-2xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 sm:mb-6">Player Rankings</h1>

        <section className="pr-filters mr-root" aria-label="Player ranking filters">
          <div className="pr-rank">
            <ModeControl label="Calc mode" tone="mr-pr-calc" value={calcMode} onChange={setCalcMode} />
            <ModeControl label="Display mode" tone="mr-pr-disp" value={displayMode} onChange={setDisplayMode} />
            <button type="button" className="pr-reset" onClick={handleReset}>Reset</button>
          </div>

          <div className="pr-block">
            <span className="pr-label">Period</span>
            <div className="pr-period-line">
              <TimePeriodSelector appearance="plain" value={period} onChange={setPeriod} customRange={customRange} onCustomRangeChange={setCustomRange} showLastNight />
              {playersData?.actual_start && playersData?.actual_end && (
                <p className="pr-range">
                  Showing {playersData.actual_start === playersData.actual_end
                    ? formatShort(playersData.actual_start)
                    : `${formatShort(playersData.actual_start)} – ${formatShort(playersData.actual_end)}`}
                </p>
              )}
            </div>
          </div>

          <div className="pr-players">
            <PositionFilter options={ALL_POSITIONS} selected={positionsPicked} onChange={setPositionsPicked} />
            <div className="pr-nba">
              <span className="pr-label">NBA team</span>
              <NbaTeamFilter selected={nbaTeams} onChange={setNbaTeams} />
            </div>
            <div className="pr-fantasy-menu">
              <span className="pr-label">Fantasy team</span>
              <FantasyTeamMenu
                value={fantasyTeam}
                onChange={setFantasyTeam}
                teams={teams ?? []}
                myTeamId={myTeamId}
                isMyTeam={isMyTeam}
              />
            </div>
            <label className="pr-field">
              <span className="pr-label">Min GP</span>
              <input
                type="number"
                min={0}
                value={minGp}
                onChange={e => setMinGp(Math.max(0, Number(e.target.value)))}
                className="pr-num"
              />
            </label>
            <label className="pr-field">
              <span className="pr-label">Min MPG</span>
              <input
                type="number"
                min={0}
                value={minMin}
                onChange={e => setMinMin(Math.max(0, Number(e.target.value)))}
                className="pr-num"
              />
            </label>
            <div className="pr-show">
              <span className="pr-label">Show</span>
              <div className="mr-seg mr-sm mr-fit pr-show-seg" role="group" aria-label="Show">
                {[50, 100, 150, 200].map(n => (
                  <button key={n} type="button" className="mr-seg-btn" aria-pressed={displayLimit === n} onClick={() => setDisplayLimit(n)}>
                    Top {n}
                  </button>
                ))}
                <button type="button" className="mr-seg-btn" aria-pressed={displayLimit === null} onClick={() => setDisplayLimit(null)}>
                  All
                </button>
              </div>
            </div>
          </div>

          <div className="pr-weights">
            <WeightSliders key={sliderResetKey} categories={categories} initialWeights={effectiveWeights} onCommit={setWeights} />
          </div>
          <div className="pr-top-search">
            <PlayerSearchBox value={search} onChange={setSearch} className="pr-search" />
            {searchQuery && hasCalculated && (
              <p className="pr-search-note" aria-live="polite">
                {sortedPlayers.length === 0
                  ? 'No players match'
                  : `${sortedPlayers.length} ${sortedPlayers.length === 1 ? 'player' : 'players'} found · ranks are overall`}
                {sortedPlayers.length > 0 && (
                  <>
                    {' · '}
                    <button
                      type="button"
                      onClick={() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                      className="pr-view-results"
                    >
                      View results ↓
                    </button>
                  </>
                )}
              </p>
            )}
          </div>
        </section>

        {period === 'custom' && customRange && (
          <CoverageNotice
            requestedStart={customRange.start}
            requestedEnd={customRange.end}
            actualStart={playersData?.actual_start}
            actualEnd={playersData?.actual_end}
          />
        )}

        {!hasCalculated && (
          <div className="text-center text-gray-400 dark:text-gray-500 py-16">
            Set your weights and press Calculate to rank players.
          </div>
        )}

        {hasCalculated && sortedPlayers.length === 0 && (
          <div className="text-center text-gray-400 dark:text-gray-500 py-16">
            {searchQuery ? (
              <>
                No players match “{search.trim()}” with the current filters.{' '}
                <button onClick={() => setSearch('')} className="text-blue-600 dark:text-blue-400 hover:underline">Clear search</button>
              </>
            ) : 'No players match the current filters.'}
          </div>
        )}

        {hasCalculated && sortedPlayers.length > 0 && (
          <div ref={resultsRef} className="pr-rankings scroll-mt-20 bg-white dark:bg-gray-800 rounded-xl shadow overflow-auto max-h-[70vh]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-20 bg-gray-50 dark:bg-gray-900">
                <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                  <Th col="rank" label="#" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} />
                  <Th col="totalZ" label="Z" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} tip={METRIC_GLOSSARY.totalZ} />
                  <th className="px-1.5 sm:px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 sticky left-0 z-10 bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700">Player</th>
                  <th className="px-1.5 sm:px-2 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap" title="Fantasy team">Fantasy</th>
                  <th className="hidden sm:table-cell px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Team</th>
                  <th className="hidden sm:table-cell px-2 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">Pos</th>
                  <Th col="min" label={displayMode === 'totals' ? 'MIN' : 'MPG'} sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} />
                  {categories.map(cat => (
                    <Th key={`raw-${cat}`} col={`${cat}_raw` as SortCol} label={CATEGORY_LABELS[cat] ?? cat} sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} punted={isPunted(cat)} />
                  ))}
                  <Th col="gp" label="GP" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} />
                  {categories.map(cat => (
                    <Th key={`z-${cat}`} col={cat} label={`${CATEGORY_LABELS[cat] ?? cat}_z`} sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} punted={isPunted(cat)} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedPlayers.map(({ ranked, rank }) => (
                  <tr
                    key={`${ranked.player.player_name}-${ranked.player.team_id}`}
                    className={`group border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50${ranked.player.team_id !== 0 && isMyTeam(ranked.player.team_id) ? ' mr-me' : ''}`}
                  >
                    <td className="px-1.5 sm:px-3 py-1.5 sm:py-2 text-gray-500 dark:text-gray-400 text-center font-mono text-xs">{rank}</td>
                    <td className="px-1.5 sm:px-3 py-1.5 sm:py-2 text-center font-semibold text-blue-600 dark:text-blue-400 text-xs sm:text-sm">{fmt(ranked.totalZ)}</td>
                    <td className="px-1.5 sm:px-3 py-1.5 sm:py-2 font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap text-xs sm:text-sm sticky left-0 z-10 bg-white dark:bg-gray-800 group-hover:bg-gray-50 dark:group-hover:bg-gray-700/50 border-r border-gray-200 dark:border-gray-700"><PlayerNameLink name={ranked.player.player_name} playerId={ranked.player.player_id} /></td>
                    <td
                      className={`px-1.5 sm:px-2 py-1.5 sm:py-2 text-xs font-medium whitespace-nowrap ${ranked.player.team_id === 0 ? 'text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-200'}`}
                      title={ranked.player.team_id === 0 ? 'Free agent' : (ranked.player.fantasy_team_name ?? undefined)}
                    >
                      {fantasyTeamAbbrev(ranked.player.team_id, abbrevById)}
                    </td>
                    <td className="hidden sm:table-cell px-3 py-2 text-gray-500 dark:text-gray-400 text-xs">{ranked.player.pro_team}</td>
                    <td className="hidden sm:table-cell px-2 py-2 text-gray-500 dark:text-gray-400 text-xs whitespace-nowrap">{ranked.player.positions.join(', ')}</td>
                    <td className="px-1.5 sm:px-3 py-1.5 sm:py-2 text-right text-gray-700 dark:text-gray-300 text-xs sm:text-sm">{ranked.player.stats.gp > 0 ? fmt(minutesValue(ranked, displayMode), displayMode === 'totals' ? 0 : 1) : '—'}</td>
                    {categories.map(cat => (
                      <td key={`raw-${cat}`} className="px-1.5 sm:px-3 py-1.5 sm:py-2 text-right text-gray-700 dark:text-gray-300 text-xs sm:text-sm">
                        {rawDisplay(ranked, cat)}
                      </td>
                    ))}
                    <td className="px-1.5 sm:px-3 py-1.5 sm:py-2 text-right text-gray-700 dark:text-gray-300 text-xs sm:text-sm">{ranked.player.stats.gp}</td>
                    {categories.map(cat => (
                      <td key={`z-${cat}`} className={`px-1.5 sm:px-3 py-1.5 sm:py-2 text-right font-mono text-xs ${isPunted(cat) ? 'text-gray-300 dark:text-gray-600' : ranked.zScores[cat] >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                        {fmt(ranked.zScores[cat])}
                      </td>
                    ))}
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

const RANK_MODES = [
  { value: 'totals', label: 'Totals' },
  { value: 'per_game', label: 'Per Game' },
] as const

function ModeControl({
  label,
  tone,
  value,
  onChange,
}: {
  label: string
  tone: string
  value: 'totals' | 'per_game'
  onChange: (mode: 'totals' | 'per_game') => void
}) {
  return (
    <div className="pr-mode">
      <span className="pr-label">{label}</span>
      <div className={`mr-seg mr-sm mr-fit ${tone}`}>
        {RANK_MODES.map(mode => (
          <button
            key={mode.value}
            type="button"
            className="mr-seg-btn"
            aria-pressed={value === mode.value}
            onClick={() => onChange(mode.value)}
          >
            {mode.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function PlayerSearchBox({ value, onChange, className = '' }: { value: string; onChange: (value: string) => void; className?: string }) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className={`relative w-full sm:max-w-md ${className}`.trim()}>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"
      >
        <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 3.4 9.83l3.64 3.63a.75.75 0 1 0 1.06-1.06l-3.63-3.64A5.5 5.5 0 0 0 9 3.5ZM5 9a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z" clipRule="evenodd" />
      </svg>
      <input
        ref={inputRef}
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        aria-label="Search players"
        placeholder="Search players…"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') onChange('') }}
        className="w-full pl-9 pr-9 py-2.5 sm:py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-base sm:text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => { onChange(''); inputRef.current?.focus() }}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-gray-700"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
          </svg>
        </button>
      )}
    </div>
  )
}

// Owns slider drag state locally so ticking a slider only re-renders this
// small subtree, not the parent (and its 500-row table). Only pushes a
// debounced "settled" value up via onCommit, once per drag/toggle.
function WeightSliders({ categories, initialWeights, onCommit }: {
  categories: RankingCategory[]
  initialWeights: Record<RankingCategory, number>
  onCommit: (weights: Record<RankingCategory, number>) => void
}) {
  const { weights, isPunted, slide: handleSlide, togglePunt } = useWeightDraft(initialWeights, onCommit)

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
      {categories.map(cat => (
        <div key={cat} className={`flex items-center gap-2 p-2 rounded-lg border ${isPunted(cat) ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20' : 'border-gray-200 dark:border-gray-600'}`}>
          <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 w-8">{CATEGORY_LABELS[cat] ?? cat}</span>
          <input
            type="range" min={0} max={2} step={0.1}
            value={isPunted(cat) ? 0 : weights[cat]}
            disabled={isPunted(cat)}
            onChange={e => handleSlide(cat, Number(e.target.value))}
            className="flex-1 accent-blue-600"
          />
          <span className="text-xs text-gray-500 w-6">{isPunted(cat) ? '—' : weights[cat].toFixed(1)}</span>
          <button
            onClick={() => togglePunt(cat)}
            className={`text-xs px-1.5 py-0.5 rounded font-medium ${isPunted(cat) ? 'bg-red-500 text-white' : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300'}`}
          >
            {isPunted(cat) ? 'PUNT' : 'punt'}
          </button>
        </div>
      ))}
    </div>
  )
}

function Th({ col, label, sortCol, sortAsc, onSort, punted, className = '', tip }: {
  col: SortCol
  label: string
  sortCol: SortCol
  sortAsc: boolean
  onSort: (col: SortCol) => void
  punted?: boolean
  className?: string
  tip?: MetricInfo
}) {
  const active = sortCol === col
  return (
    <th
      className={`px-1.5 py-2 sm:px-3 text-right text-xs font-semibold select-none whitespace-nowrap ${punted ? 'text-gray-300 dark:text-gray-600' : active ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'} ${className}`}
    >
      <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
        <span
          onClick={() => onSort(col)}
          tabIndex={0}
          role="button"
          onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onSort(col)}
          aria-sort={active ? (sortAsc ? 'ascending' : 'descending') : 'none'}
          className="cursor-pointer"
        >
          {label}{active ? (sortAsc ? ' ↑' : ' ↓') : ''}
        </span>
        {tip && <InfoTip title={tip.title} body={tip.body} formula={tip.formula} />}
      </span>
    </th>
  )
}

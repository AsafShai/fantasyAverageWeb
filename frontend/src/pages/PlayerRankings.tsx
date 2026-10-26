import { useState, useMemo, useRef, useEffect, useTransition } from 'react'
import { usePersistedState } from '../hooks/usePersistedState'
import { useGetAllPlayersQuery, useGetLatestMovesQuery, useGetTeamsListQuery } from '../store/api/fantasyApi'
import { useMyTeam } from '../context/MyTeamContext'
import { fantasyTeamOptionLabel, leadWithMyTeam } from '../myTeam/display'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import { getErrorMessage } from '../utils/errorMessage'
import TimePeriodSelector from '../components/TimePeriodSelector'
import { CoverageNotice } from '../components/DateRangePicker'
import PlayerNameLink from '../components/PlayerNameLink'
import { formatShort } from '../utils/dateRange'
import { orderCategories } from '../utils/statOrder'
import InfoTip from '../components/InfoTip'
import { METRIC_GLOSSARY, type MetricInfo } from '../constants/metricGlossary'
import type { TimePeriod, CustomDateRange } from '../types/api'
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
} from '../utils/playerRankings'

type SortCol = 'rank' | 'totalZ' | 'gp' | 'mpg' | RankingCategory | `${RankingCategory}_raw`

const DEFAULT_WEIGHTS = Object.fromEntries(DEFAULT_CATEGORIES.map(c => [c, 1])) as Record<RankingCategory, number>

const ALL_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C']

/** null = everyone, 0 = free agents / waivers, 'rostered' = on any fantasy team. */
type FantasyTeamFilter = number | 'rostered' | null

function matchesFantasyTeam(teamId: number, filter: FantasyTeamFilter): boolean {
  if (filter === null) return true
  if (filter === 'rostered') return teamId !== 0
  return teamId === filter
}

/** Short fantasy code. team_id 0 is a free agent or on waivers. */
function fantasyTeamAbbrev(teamId: number, abbrevById: Map<number, string>): string {
  if (teamId === 0) return 'FA'
  return abbrevById.get(teamId) ?? '—'
}

function getSortVal(ranked: RankedPlayer, col: SortCol, displayMode: 'totals' | 'per_game'): number {
  if (col === 'totalZ') return ranked.totalZ
  if (col === 'gp') return ranked.player.stats.gp
  if (col === 'mpg') return ranked.player.stats.gp > 0 ? ranked.player.stats.minutes / ranked.player.stats.gp : 0
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
  const [position, setPosition] = usePersistedState<string | null>('playerRankings.position', null)
  const [fantasyTeam, setFantasyTeam] = usePersistedState<FantasyTeamFilter>('playerRankings.fantasyTeam', null)
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
  const [sliderResetKey, setSliderResetKey] = useState(0)
  const [sortCol, setSortCol] = useState<SortCol>('totalZ')
  const [sortAsc, setSortAsc] = useState(false)
  const [rankedPlayers, setRankedPlayers] = useState<RankedPlayer[]>([])
  const [hasCalculated, setHasCalculated] = useState(false)
  const [, startTransition] = useTransition()

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
    setPosition(null)
    setFantasyTeam(null)
    setWeights({ ...DEFAULT_WEIGHTS })
    setDisplayLimit(null)
    setSliderResetKey(k => k + 1)
  }

  const isPunted = (cat: RankingCategory) => effectiveWeights[cat] === 0

  const recompute = () => {
    const config: RankingsConfig = { calcMode, minGp, minMin, position, weights: effectiveWeights }
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
    const filtered = rankedPlayers.filter(r =>
      r.player.stats.gp >= minGp &&
      (r.player.stats.gp > 0 ? r.player.stats.minutes / r.player.stats.gp : 0) >= minMin &&
      (position === null || r.player.positions.includes(position))
    )
    // rankedPlayers is already sorted by totalZ descending, so this keeps
    // "top N by rank" regardless of which column is currently sorted below.
    // The row number is the totalZ rank, so it stays with the player whichever
    // column the table is sorted by. It's taken before the fantasy-team filter
    // so a team's players keep their rank among the whole pool.
    const withRank = filtered
      .map((ranked, idx) => ({ ranked, rank: idx + 1 }))
      .filter(r => matchesFantasyTeam(r.ranked.player.team_id, fantasyTeam))
    const limited = displayLimit === null ? withRank : withRank.slice(0, displayLimit)
    return limited.sort((a, b) => {
      if (sortCol === 'rank') return sortAsc ? a.rank - b.rank : b.rank - a.rank
      const aVal = getSortVal(a.ranked, sortCol, displayMode)
      const bVal = getSortVal(b.ranked, sortCol, displayMode)
      return sortAsc ? aVal - bVal : bVal - aVal
    })
  }, [rankedPlayers, sortCol, sortAsc, minGp, minMin, position, fantasyTeam, displayMode, displayLimit])

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

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div className="max-w-screen-2xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Player Rankings</h1>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-3 sm:p-4 mb-6 space-y-3 sm:space-y-4">

          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-4 sm:items-start">
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Calc mode</label>
              <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden text-sm">
                {(['totals', 'per_game'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setCalcMode(m)}
                    className={`px-3 py-1.5 ${calcMode === m ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200'}`}
                  >
                    {m === 'totals' ? 'Totals' : 'Per Game'}
                  </button>
                ))}
              </div>
            </div>

            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Display mode</label>
              <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden text-sm">
                {(['totals', 'per_game'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setDisplayMode(m)}
                    className={`px-3 py-1.5 ${displayMode === m ? 'bg-purple-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200'}`}
                  >
                    {m === 'totals' ? 'Totals' : 'Per Game'}
                  </button>
                ))}
              </div>
            </div>

            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Period</label>
              <TimePeriodSelector value={period} onChange={setPeriod} customRange={customRange} onCustomRangeChange={setCustomRange} showLastNight />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Min GP</label>
              <input
                type="number" min={0} value={minGp}
                onChange={e => setMinGp(Math.max(0, Number(e.target.value)))}
                className="w-20 px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Min MPG</label>
              <input
                type="number" min={0} value={minMin}
                onChange={e => setMinMin(Math.max(0, Number(e.target.value)))}
                className="w-24 px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Position</label>
              <select
                value={position ?? ''}
                onChange={e => setPosition(e.target.value || null)}
                className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
              >
                <option value="">All</option>
                {ALL_POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            {/* min-w-0 + w-full keep long team names from pushing the select past the mobile grid cell. */}
            <div className="min-w-0">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Fantasy team</label>
              <select
                value={fantasyTeam ?? ''}
                onChange={e => {
                  const value = e.target.value
                  setFantasyTeam(value === '' ? null : value === 'rostered' ? 'rostered' : Number(value))
                }}
                className="w-full sm:w-auto sm:max-w-[14rem] truncate px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
              >
                <option value="">All</option>
                <option value="rostered">Rostered</option>
                <option value="0">Free Agents / Waivers</option>
                {leadWithMyTeam(teams ?? [], myTeamId).map(team => (
                  <option key={team.team_id} value={team.team_id}>
                    {fantasyTeamOptionLabel(team.team_name, isMyTeam(team.team_id))}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Show</label>
              <select
                value={displayLimit ?? ''}
                onChange={e => setDisplayLimit(e.target.value === '' ? null : Number(e.target.value))}
                className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
              >
                {[50, 100, 150, 200].map(n => <option key={n} value={n}>Top {n}</option>)}
                <option value="">All</option>
              </select>
            </div>
          </div>

          {playersData?.actual_start && playersData?.actual_end && (
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Showing {playersData.actual_start === playersData.actual_end
                ? formatShort(playersData.actual_start)
                : `${formatShort(playersData.actual_start)} – ${formatShort(playersData.actual_end)}`}
            </p>
          )}

          <WeightSliders key={sliderResetKey} categories={categories} initialWeights={effectiveWeights} onCommit={setWeights} />

          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {players.length} players loaded · Blue = calc mode · Purple = display mode · everything updates live
            </p>
            <button
              onClick={handleReset}
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 font-semibold rounded-lg transition-colors"
            >
              Reset
            </button>
          </div>
        </div>

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
            No players match the current filters.
          </div>
        )}

        {hasCalculated && sortedPlayers.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-auto max-h-[70vh]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-20 bg-gray-50 dark:bg-gray-900">
                <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                  <Th col="rank" label="#" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} />
                  <Th col="totalZ" label="Z" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} tip={METRIC_GLOSSARY.totalZ} />
                  <th className="px-1.5 sm:px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 sticky left-0 z-10 bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700">Player</th>
                  <th className="px-1.5 sm:px-2 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap" title="Fantasy team">Fantasy</th>
                  <th className="hidden sm:table-cell px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Team</th>
                  <th className="hidden sm:table-cell px-2 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">Pos</th>
                  <Th col="mpg" label="MPG" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} className="hidden sm:table-cell" />
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
                  <tr key={`${ranked.player.player_name}-${ranked.player.team_id}`} className="group border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
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
                    <td className="hidden sm:table-cell px-3 py-2 text-right text-gray-700 dark:text-gray-300">{ranked.player.stats.gp > 0 ? fmt(ranked.player.stats.minutes / ranked.player.stats.gp, 1) : '—'}</td>
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

// Owns slider drag state locally so ticking a slider only re-renders this
// small subtree, not the parent (and its 500-row table). Only pushes a
// debounced "settled" value up via onCommit, once per drag/toggle.
function WeightSliders({ categories, initialWeights, onCommit }: {
  categories: RankingCategory[]
  initialWeights: Record<RankingCategory, number>
  onCommit: (weights: Record<RankingCategory, number>) => void
}) {
  const [weights, setWeights] = useState(initialWeights)
  const prevWeightsRef = useRef(initialWeights)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
  }, [])

  const isPunted = (cat: RankingCategory) => weights[cat] === 0

  const handleSlide = (cat: RankingCategory, value: number) => {
    setWeights(w => {
      const next = { ...w, [cat]: value }
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => onCommit(next), 150)
      return next
    })
  }

  const togglePunt = (cat: RankingCategory) => {
    setWeights(w => {
      const next = w[cat] === 0
        ? { ...w, [cat]: prevWeightsRef.current[cat] }
        : { ...w, [cat]: 0 }
      if (w[cat] !== 0) prevWeightsRef.current = { ...prevWeightsRef.current, [cat]: w[cat] }
      if (debounceRef.current) clearTimeout(debounceRef.current)
      onCommit(next)
      return next
    })
  }

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

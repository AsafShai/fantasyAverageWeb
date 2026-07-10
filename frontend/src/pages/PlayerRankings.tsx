import { useState, useMemo, useRef, useEffect, useTransition } from 'react'
import { useGetAllPlayersQuery } from '../store/api/fantasyApi'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import TimePeriodSelector from '../components/TimePeriodSelector'
import { CoverageNotice } from '../components/DateRangePicker'
import { formatShort } from '../utils/dateRange'
import type { TimePeriod, CustomDateRange } from '../types/api'
import {
  computePlayerRankings,
  getRawValue,
  partitionByDataAvailability,
  CATEGORIES,
  CATEGORY_LABELS,
  type RankingCategory,
  type RankedPlayer,
  type RankingsConfig,
} from '../utils/playerRankings'

type SortCol = 'totalZ' | 'gp' | 'mpg' | RankingCategory | `${RankingCategory}_raw`

const DEFAULT_WEIGHTS = Object.fromEntries(CATEGORIES.map(c => [c, 1])) as Record<RankingCategory, number>

const ALL_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C']

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
    limit: 500,
    time_period: period,
    ...(period === 'custom' && customRange ? { start: customRange.start, end: customRange.end } : {}),
  })
  const allPlayers = useMemo(() => playersData?.players ?? [], [playersData])
  const { available: players, excluded: excludedPlayers } = useMemo(
    () => partitionByDataAvailability(allPlayers),
    [allPlayers]
  )

  const [calcMode, setCalcMode] = useState<'totals' | 'per_game'>('per_game')
  const [displayMode, setDisplayMode] = useState<'totals' | 'per_game'>('per_game')
  const [minGp, setMinGp] = useState(0)
  const [minMin, setMinMin] = useState(0)
  const [position, setPosition] = useState<string | null>(null)
  const [weights, setWeights] = useState<Record<RankingCategory, number>>({ ...DEFAULT_WEIGHTS })
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
    setWeights({ ...DEFAULT_WEIGHTS })
    setDisplayLimit(null)
    setSliderResetKey(k => k + 1)
  }

  const isPunted = (cat: RankingCategory) => weights[cat] === 0

  const recompute = () => {
    const config: RankingsConfig = { calcMode, minGp, minMin, position, weights }
    const next = computePlayerRankings(players, config)
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
    const limited = displayLimit === null ? filtered : filtered.slice(0, displayLimit)
    return [...limited].sort((a, b) => {
      const aVal = getSortVal(a, sortCol, displayMode)
      const bVal = getSortVal(b, sortCol, displayMode)
      return sortAsc ? aVal - bVal : bVal - aVal
    })
  }, [rankedPlayers, sortCol, sortAsc, minGp, minMin, position, displayMode, displayLimit])

  const handleSort = (col: SortCol) => {
    if (col === sortCol) setSortAsc(a => !a)
    else { setSortCol(col); setSortAsc(false) }
  }

  const fmt = (n: number, decimals = 2) => n.toFixed(decimals)
  const fmtPct = (n: number) => (n * 100).toFixed(1) + '%'

  const rawDisplay = (ranked: RankedPlayer, cat: RankingCategory) => {
    const val = getRawValue(ranked.player, cat, displayMode)
    return cat === 'fg_pct' || cat === 'ft_pct' ? fmtPct(val) : fmt(val, 1)
  }

  if (isLoading) return <LoadingSpinner />
  if (error) return <ErrorMessage message="Failed to load players." />

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
              <TimePeriodSelector value={period} onChange={setPeriod} customRange={customRange} onCustomRangeChange={setCustomRange} />
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
              Showing {formatShort(playersData.actual_start)} – {formatShort(playersData.actual_end)}
            </p>
          )}

          <WeightSliders key={sliderResetKey} initialWeights={weights} onCommit={setWeights} />

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
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                  <th className="px-1.5 sm:px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">#</th>
                  <Th col="totalZ" label="Z" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} />
                  <th className="px-1.5 sm:px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 sticky left-0 z-10 bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700">Player</th>
                  <th className="hidden sm:table-cell px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Team</th>
                  <th className="hidden sm:table-cell px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Pos</th>
                  <Th col="gp" label="GP" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} />
                  <Th col="mpg" label="MPG" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} className="hidden sm:table-cell" />
                  {CATEGORIES.map(cat => (
                    <Th key={`raw-${cat}`} col={`${cat}_raw` as SortCol} label={CATEGORY_LABELS[cat]} sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} punted={isPunted(cat)} />
                  ))}
                  {CATEGORIES.map(cat => (
                    <Th key={`z-${cat}`} col={cat} label={`${CATEGORY_LABELS[cat]}_z`} sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} punted={isPunted(cat)} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedPlayers.map((ranked, idx) => (
                  <tr key={`${ranked.player.player_name}-${ranked.player.team_id}`} className="group border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-1.5 sm:px-3 py-1.5 sm:py-2 text-gray-500 dark:text-gray-400 text-center font-mono text-xs">{idx + 1}</td>
                    <td className="px-1.5 sm:px-3 py-1.5 sm:py-2 text-center font-semibold text-blue-600 dark:text-blue-400 text-xs sm:text-sm">{fmt(ranked.totalZ)}</td>
                    <td className="px-1.5 sm:px-3 py-1.5 sm:py-2 font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap text-xs sm:text-sm sticky left-0 z-10 bg-white dark:bg-gray-800 group-hover:bg-gray-50 dark:group-hover:bg-gray-700/50 border-r border-gray-200 dark:border-gray-700">{ranked.player.player_name}</td>
                    <td className="hidden sm:table-cell px-3 py-2 text-gray-500 dark:text-gray-400 text-xs">{ranked.player.pro_team}</td>
                    <td className="hidden sm:table-cell px-3 py-2 text-gray-500 dark:text-gray-400 text-xs">{ranked.player.positions.join(', ')}</td>
                    <td className="px-1.5 sm:px-3 py-1.5 sm:py-2 text-right text-gray-700 dark:text-gray-300 text-xs sm:text-sm">{ranked.player.stats.gp}</td>
                    <td className="hidden sm:table-cell px-3 py-2 text-right text-gray-700 dark:text-gray-300">{ranked.player.stats.gp > 0 ? fmt(ranked.player.stats.minutes / ranked.player.stats.gp, 1) : '—'}</td>
                    {CATEGORIES.map(cat => (
                      <td key={`raw-${cat}`} className="px-1.5 sm:px-3 py-1.5 sm:py-2 text-right text-gray-700 dark:text-gray-300 text-xs sm:text-sm">
                        {rawDisplay(ranked, cat)}
                      </td>
                    ))}
                    {CATEGORIES.map(cat => (
                      <td key={`z-${cat}`} className={`px-3 py-2 text-right font-mono text-xs ${isPunted(cat) ? 'text-gray-300 dark:text-gray-600' : ranked.zScores[cat] >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
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
function WeightSliders({ initialWeights, onCommit }: {
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
      {CATEGORIES.map(cat => (
        <div key={cat} className={`flex items-center gap-2 p-2 rounded-lg border ${isPunted(cat) ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20' : 'border-gray-200 dark:border-gray-600'}`}>
          <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 w-8">{CATEGORY_LABELS[cat]}</span>
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

function Th({ col, label, sortCol, sortAsc, onSort, punted, className = '' }: {
  col: SortCol
  label: string
  sortCol: SortCol
  sortAsc: boolean
  onSort: (col: SortCol) => void
  punted?: boolean
  className?: string
}) {
  const active = sortCol === col
  return (
    <th
      onClick={() => onSort(col)}
      tabIndex={0}
      role="button"
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onSort(col)}
      aria-sort={active ? (sortAsc ? 'ascending' : 'descending') : 'none'}
      className={`px-1.5 py-2 sm:px-3 text-right text-xs font-semibold cursor-pointer select-none ${punted ? 'text-gray-300 dark:text-gray-600' : active ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'} ${className}`}
    >
      {label}{active ? (sortAsc ? ' ↑' : ' ↓') : ''}
    </th>
  )
}

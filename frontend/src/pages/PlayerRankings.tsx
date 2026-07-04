import { useState, useMemo, useRef, useEffect } from 'react'
import { useGetAllPlayersQuery } from '../store/api/fantasyApi'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import {
  computePlayerRankings,
  getRawValue,
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
  const [period, setPeriod] = useState<'season' | 'last_7' | 'last_15' | 'last_30'>('season')
  const { data: playersData, isLoading, error } = useGetAllPlayersQuery({ limit: 500, time_period: period })
  const players = playersData?.players ?? []

  const [calcMode, setCalcMode] = useState<'totals' | 'per_game'>('per_game')
  const [displayMode, setDisplayMode] = useState<'totals' | 'per_game'>('per_game')
  const [minGp, setMinGp] = useState(0)
  const [minMin, setMinMin] = useState(0)
  const [position, setPosition] = useState<string | null>(null)
  const [weights, setWeights] = useState<Record<RankingCategory, number>>({ ...DEFAULT_WEIGHTS })
  const [displayLimit, setDisplayLimit] = useState<number | null>(null)
  const prevWeightsRef = useRef<Record<RankingCategory, number>>({ ...DEFAULT_WEIGHTS })
  const [sortCol, setSortCol] = useState<SortCol>('totalZ')
  const [sortAsc, setSortAsc] = useState(false)
  const [rankedPlayers, setRankedPlayers] = useState<RankedPlayer[]>([])
  const [hasCalculated, setHasCalculated] = useState(false)

  const handleReset = () => {
    setCalcMode('per_game')
    setDisplayMode('per_game')
    setPeriod('season')
    setMinGp(0)
    setMinMin(0)
    setPosition(null)
    setWeights({ ...DEFAULT_WEIGHTS })
    setDisplayLimit(null)
  }

  const isPunted = (cat: RankingCategory) => weights[cat] === 0

  const togglePunt = (cat: RankingCategory) => {
    if (weights[cat] === 0) {
      setWeights(w => ({ ...w, [cat]: prevWeightsRef.current[cat] }))
    } else {
      prevWeightsRef.current = { ...prevWeightsRef.current, [cat]: weights[cat] }
      setWeights(w => ({ ...w, [cat]: 0 }))
    }
  }

  const handleCalculate = () => {
    const config: RankingsConfig = { calcMode, minGp, minMin, position, weights, displayLimit }
    setRankedPlayers(computePlayerRankings(players, config))
    setHasCalculated(true)
    setSortCol('totalZ')
    setSortAsc(false)
  }

  useEffect(() => {
    if (players.length > 0) {
      handleCalculate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players])

  const sortedPlayers = useMemo(() => {
    if (!rankedPlayers.length) return []
    const filtered = rankedPlayers.filter(r =>
      r.player.stats.gp >= minGp &&
      (r.player.stats.gp > 0 ? r.player.stats.minutes / r.player.stats.gp : 0) >= minMin &&
      (position === null || r.player.positions.includes(position))
    )
    return [...filtered].sort((a, b) => {
      const aVal = getSortVal(a, sortCol, displayMode)
      const bVal = getSortVal(b, sortCol, displayMode)
      return sortAsc ? aVal - bVal : bVal - aVal
    })
  }, [rankedPlayers, sortCol, sortAsc, minGp, minMin, position, displayMode])

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

          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-4 sm:items-end">
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

            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Period</label>
              <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden text-sm">
                {([['season', 'Season'], ['last_7', 'L7'], ['last_15', 'L15'], ['last_30', 'L30']] as const).map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setPeriod(val)}
                    className={`px-3 py-1.5 ${period === val ? 'bg-green-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
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

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
            {CATEGORIES.map(cat => (
              <div key={cat} className={`flex items-center gap-2 p-2 rounded-lg border ${isPunted(cat) ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20' : 'border-gray-200 dark:border-gray-600'}`}>
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 w-8">{CATEGORY_LABELS[cat]}</span>
                <input
                  type="range" min={0} max={2} step={0.1}
                  value={isPunted(cat) ? 0 : weights[cat]}
                  disabled={isPunted(cat)}
                  onChange={e => setWeights(w => ({ ...w, [cat]: Number(e.target.value) }))}
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

          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {players.length} players loaded · Blue = calc mode · Purple = display mode · GP/MPG/position filter instantly
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleReset}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 font-semibold rounded-lg transition-colors"
              >
                Reset
              </button>
              <button
                onClick={handleCalculate}
                disabled={players.length === 0}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-lg transition-colors"
              >
                Calculate
              </button>
            </div>
          </div>
        </div>

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
                  <th className="px-1.5 sm:px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 sticky left-0 bg-gray-50 dark:bg-gray-900">#</th>
                  <Th col="totalZ" label="Z" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} />
                  <th className="px-1.5 sm:px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Player</th>
                  <th className="hidden sm:table-cell px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Team</th>
                  <th className="hidden sm:table-cell px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Pos</th>
                  <Th col="gp" label="GP" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} />
                  <Th col="mpg" label="MPG" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} className="hidden sm:table-cell" />
                  {CATEGORIES.map(cat => (
                    <Th key={`raw-${cat}`} col={`${cat}_raw` as SortCol} label={CATEGORY_LABELS[cat]} sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} punted={isPunted(cat)} />
                  ))}
                  {CATEGORIES.map(cat => (
                    <Th key={`z-${cat}`} col={cat} label={`${CATEGORY_LABELS[cat]}_z`} sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} punted={isPunted(cat)} className="hidden sm:table-cell" />
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedPlayers.map((ranked, idx) => (
                  <tr key={`${ranked.player.player_name}-${ranked.player.team_id}`} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-1.5 sm:px-3 py-1.5 sm:py-2 text-gray-500 dark:text-gray-400 sticky left-0 bg-white dark:bg-gray-800 text-center font-mono text-xs">{idx + 1}</td>
                    <td className="px-1.5 sm:px-3 py-1.5 sm:py-2 text-center font-semibold text-blue-600 dark:text-blue-400 text-xs sm:text-sm">{fmt(ranked.totalZ)}</td>
                    <td className="px-1.5 sm:px-3 py-1.5 sm:py-2 font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap text-xs sm:text-sm">{ranked.player.player_name}</td>
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
                      <td key={`z-${cat}`} className={`hidden sm:table-cell px-3 py-2 text-right font-mono text-xs ${isPunted(cat) ? 'text-gray-300 dark:text-gray-600' : ranked.zScores[cat] >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
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

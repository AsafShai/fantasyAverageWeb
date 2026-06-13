import { useState, useMemo } from 'react'
import { useGetPlayerRankingsQuery } from '../store/api/fantasyApi'
import {
  computePlayerRankings,
  getRawValue,
  CATEGORIES,
  CATEGORY_LABELS,
  type RankingCategory,
  type RankedPlayer,
  type RankingsConfig,
} from '../utils/playerRankings'

const DEFAULT_WEIGHTS = Object.fromEntries(CATEGORIES.map(c => [c, 1])) as Record<RankingCategory, number>

const ALL_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C']

export default function PlayerRankings() {
  const { data: players = [], isLoading, error } = useGetPlayerRankingsQuery()

  const [calcMode, setCalcMode] = useState<'totals' | 'per_game'>('per_game')
  const [displayMode, setDisplayMode] = useState<'totals' | 'per_game'>('per_game')
  const [minGp, setMinGp] = useState(0)
  const [minMin, setMinMin] = useState(0)
  const [position, setPosition] = useState<string | null>(null)
  const [weights, setWeights] = useState<Record<RankingCategory, number>>({ ...DEFAULT_WEIGHTS })
  const [sortCol, setSortCol] = useState<'totalZ' | RankingCategory>('totalZ')
  const [sortAsc, setSortAsc] = useState(false)
  const [rankedPlayers, setRankedPlayers] = useState<RankedPlayer[]>([])
  const [hasCalculated, setHasCalculated] = useState(false)

  const isPunted = (cat: RankingCategory) => weights[cat] === 0

  const togglePunt = (cat: RankingCategory) => {
    setWeights(w => ({ ...w, [cat]: w[cat] === 0 ? 1 : 0 }))
  }

  const handleCalculate = () => {
    const config: RankingsConfig = { calcMode, minGp, minMin, position, weights }
    setRankedPlayers(computePlayerRankings(players, config))
    setHasCalculated(true)
    setSortCol('totalZ')
    setSortAsc(false)
  }

  const sortedPlayers = useMemo(() => {
    if (!rankedPlayers.length) return []
    return [...rankedPlayers].sort((a, b) => {
      const aVal = sortCol === 'totalZ' ? a.totalZ : a.zScores[sortCol]
      const bVal = sortCol === 'totalZ' ? b.totalZ : b.zScores[sortCol]
      return sortAsc ? aVal - bVal : bVal - aVal
    })
  }, [rankedPlayers, sortCol, sortAsc])

  const handleSort = (col: typeof sortCol) => {
    if (col === sortCol) setSortAsc(a => !a)
    else { setSortCol(col); setSortAsc(false) }
  }

  const fmt = (n: number, decimals = 2) => n.toFixed(decimals)
  const fmtPct = (n: number) => (n * 100).toFixed(1) + '%'

  const rawDisplay = (ranked: RankedPlayer, cat: RankingCategory) => {
    const val = getRawValue(ranked.player, cat, displayMode)
    return cat === 'fg_pct' || cat === 'ft_pct' ? fmtPct(val) : fmt(val, 1)
  }

  if (isLoading) return <div className="p-8 text-center text-gray-500 dark:text-gray-400">Loading player data...</div>
  if (error) return <div className="p-8 text-center text-red-500">Failed to load players.</div>

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div className="max-w-screen-2xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Player Rankings</h1>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 mb-6 space-y-4">

          <div className="flex flex-wrap gap-4 items-end">
            <div>
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

            <div>
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

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Min GP</label>
              <input
                type="number" min={0} value={minGp}
                onChange={e => setMinGp(Math.max(0, Number(e.target.value)))}
                className="w-20 px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Min MIN (season)</label>
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
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
              {players.length} players loaded · Blue toggle = calc mode · Purple = display mode
            </p>
            <button
              onClick={handleCalculate}
              disabled={players.length === 0}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-lg transition-colors"
            >
              Calculate
            </button>
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
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 sticky left-0 bg-gray-50 dark:bg-gray-900">Rank</th>
                  <Th col="totalZ" label="Z Score" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} />
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Player</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Team</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Pos</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">GP</th>
                  {CATEGORIES.map(cat => (
                    <th key={`raw-${cat}`} className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">
                      {CATEGORY_LABELS[cat]}
                    </th>
                  ))}
                  {CATEGORIES.map(cat => (
                    <Th key={`z-${cat}`} col={cat} label={`${CATEGORY_LABELS[cat]}_z`} sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} punted={isPunted(cat)} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedPlayers.map((ranked, idx) => (
                  <tr key={ranked.player.player_name + idx} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-3 py-2 text-gray-500 dark:text-gray-400 sticky left-0 bg-white dark:bg-gray-800 text-center font-mono text-xs">{idx + 1}</td>
                    <td className="px-3 py-2 text-center font-semibold text-blue-600 dark:text-blue-400">{fmt(ranked.totalZ)}</td>
                    <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap">{ranked.player.player_name}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{ranked.player.pro_team}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-gray-400 text-xs">{ranked.player.positions.join(', ')}</td>
                    <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">{ranked.player.stats.gp}</td>
                    {CATEGORIES.map(cat => (
                      <td key={`raw-${cat}`} className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">
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

function Th({ col, label, sortCol, sortAsc, onSort, punted }: {
  col: 'totalZ' | RankingCategory
  label: string
  sortCol: string
  sortAsc: boolean
  onSort: (col: 'totalZ' | RankingCategory) => void
  punted?: boolean
}) {
  const active = sortCol === col
  return (
    <th
      onClick={() => onSort(col)}
      className={`px-3 py-2 text-right text-xs font-semibold cursor-pointer select-none ${punted ? 'text-gray-300 dark:text-gray-600' : active ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
    >
      {label}{active ? (sortAsc ? ' ↑' : ' ↓') : ''}
    </th>
  )
}

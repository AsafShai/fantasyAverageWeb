import { useState, useMemo } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Brush,
  ResponsiveContainer,
} from 'recharts'
import { useGetRankingsOverTimeQuery } from '../store/api/fantasyApi'
import LoadingSpinner from './LoadingSpinner'
import ErrorMessage from './ErrorMessage'
import type { OverTimeSource, TeamTimeSeriesPoint } from '../types/api'

const TEAM_COLORS = [
  '#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed',
  '#db2777', '#0891b2', '#65a30d', '#ea580c', '#9333ea',
  '#0d9488', '#b45309',
]

type SourceOption = { value: OverTimeSource; label: string }
const SOURCES: SourceOption[] = [
  { value: 'rankings_avg', label: 'Rankings by Avg' },
  { value: 'rankings_totals', label: 'Rankings by Total' },
  { value: 'averages', label: 'Per-Game Avg' },
  { value: 'snapshot', label: 'Season Totals' },
]

type MetricOption = { value: string; label: string }
const RANKINGS_METRICS: MetricOption[] = [
  { value: 'rk_total', label: 'Total Score' },
  { value: 'rk_pts', label: 'Points Rank' },
  { value: 'rk_reb', label: 'Rebounds Rank' },
  { value: 'rk_ast', label: 'Assists Rank' },
  { value: 'rk_stl', label: 'Steals Rank' },
  { value: 'rk_blk', label: 'Blocks Rank' },
  { value: 'rk_three_pm', label: '3PM Rank' },
  { value: 'rk_fg_pct', label: 'FG% Rank' },
  { value: 'rk_ft_pct', label: 'FT% Rank' },
]
const STAT_METRICS: MetricOption[] = [
  { value: 'pts', label: 'Points' },
  { value: 'reb', label: 'Rebounds' },
  { value: 'ast', label: 'Assists' },
  { value: 'stl', label: 'Steals' },
  { value: 'blk', label: 'Blocks' },
  { value: 'three_pm', label: '3PM' },
  { value: 'fg_pct', label: 'FG%' },
  { value: 'ft_pct', label: 'FT%' },
]

const SOURCE_METRICS: Record<OverTimeSource, MetricOption[]> = {
  rankings_avg: RANKINGS_METRICS,
  rankings_totals: RANKINGS_METRICS,
  averages: STAT_METRICS,
  snapshot: STAT_METRICS,
}

const SOURCE_DEFAULT_METRIC: Record<OverTimeSource, string> = {
  rankings_avg: 'rk_total',
  rankings_totals: 'rk_total',
  averages: 'pts',
  snapshot: 'pts',
}

const formatDate = (dateStr: string) => {
  const d = new Date(dateStr)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

const RankingsOverTimeChart = () => {
  const [source, setSource] = useState<OverTimeSource>('rankings_avg')
  const [metric, setMetric] = useState<string>('rk_total')
  const [teamsOpen, setTeamsOpen] = useState(false)

  const { data, error, isLoading } = useGetRankingsOverTimeQuery({ source })

  const allTeams = useMemo(() => {
    if (!data) return []
    const seen = new Map<number, string>()
    data.data.forEach(p => { if (!seen.has(p.team_id)) seen.set(p.team_id, p.team_name) })
    return Array.from(seen.entries()).map(([team_id, team_name]) => ({ team_id, team_name }))
  }, [data])

  const [selectedTeamIds, setSelectedTeamIds] = useState<Set<number> | null>(null)

  const effectiveSelectedIds = useMemo(
    () => selectedTeamIds ?? new Set(allTeams.map(t => t.team_id)),
    [selectedTeamIds, allTeams],
  )

  const metrics = SOURCE_METRICS[source]

  const handleSourceChange = (newSource: OverTimeSource) => {
    setSource(newSource)
    setMetric(SOURCE_DEFAULT_METRIC[newSource])
  }

  const chartData = useMemo(() => {
    if (!data) return []
    const byDate = new Map<string, Record<string, number | string>>()
    data.data
      .filter(p => effectiveSelectedIds.has(p.team_id))
      .forEach((p: TeamTimeSeriesPoint) => {
        if (!byDate.has(p.date)) byDate.set(p.date, { date: p.date })
        const entry = byDate.get(p.date)!
        const val = p[metric as keyof TeamTimeSeriesPoint]
        entry[p.team_name] = val !== undefined && val !== null ? Number(val) : NaN
      })
    return Array.from(byDate.values()).sort((a, b) =>
      String(a.date).localeCompare(String(b.date)),
    )
  }, [data, metric, effectiveSelectedIds])

  const visibleTeams = allTeams.filter(t => effectiveSelectedIds.has(t.team_id))

  const toggleTeam = (teamId: number) => {
    const next = new Set(effectiveSelectedIds)
    if (next.has(teamId)) {
      next.delete(teamId)
    } else {
      next.add(teamId)
    }
    setSelectedTeamIds(next)
  }

  const selectAll = () => setSelectedTeamIds(null)
  const clearAll = () => setSelectedTeamIds(new Set())

  const allSelected = effectiveSelectedIds.size === allTeams.length
  const noneSelected = effectiveSelectedIds.size === 0

  return (
    <div>
      <h2 className="text-xl font-semibold mb-1">Rankings Over Time</h2>
      <p className="text-gray-600 mb-4 text-sm">
        Track how each team's category rankings or stats have evolved through the season.
      </p>

      <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:flex-wrap sm:items-start">
        <div className="bg-gray-100 p-1.5 rounded-lg grid grid-cols-2 gap-1 sm:flex sm:gap-1">
          {SOURCES.map(s => (
            <button
              key={s.value}
              onClick={() => handleSourceChange(s.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 whitespace-nowrap ${
                source === s.value
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <select
          value={metric}
          onChange={e => setMetric(e.target.value)}
          className="border border-gray-300 rounded-md px-3 py-1.5 text-xs text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-full sm:w-auto"
        >
          {metrics.map(m => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>

        <div className="relative w-full sm:w-auto">
          <button
            onClick={() => setTeamsOpen(o => !o)}
            className="w-full sm:w-auto border border-gray-300 rounded-md px-3 py-1.5 text-xs text-gray-700 bg-white hover:bg-gray-50 transition-colors flex items-center justify-between sm:justify-start gap-2"
          >
            <span>Teams ({effectiveSelectedIds.size}/{allTeams.length})</span>
            <span>{teamsOpen ? '▲' : '▼'}</span>
          </button>
          {teamsOpen && (
            <div className="absolute z-10 top-full mt-1 left-0 right-0 sm:right-auto bg-white border border-gray-200 rounded-lg shadow-lg p-3 sm:min-w-[220px]">
              <div className="flex gap-3 mb-2">
                <button
                  onClick={selectAll}
                  disabled={allSelected}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Select All
                </button>
                <button
                  onClick={clearAll}
                  disabled={noneSelected}
                  className="text-xs text-red-500 hover:text-red-700 font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Clear All
                </button>
              </div>
              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {allTeams.map((team, idx) => (
                  <label key={team.team_id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={effectiveSelectedIds.has(team.team_id)}
                      onChange={() => toggleTeam(team.team_id)}
                      className="rounded flex-shrink-0"
                    />
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: TEAM_COLORS[idx % TEAM_COLORS.length] }}
                    />
                    <span className="text-xs text-gray-700 truncate">{team.team_name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {isLoading && <LoadingSpinner />}
      {error && <ErrorMessage message="Failed to load over-time data" />}
      {!isLoading && !error && noneSelected && (
        <p className="text-gray-500 text-sm text-center py-8">No teams selected. Use the Teams picker to add teams.</p>
      )}
      {!isLoading && !error && !noneSelected && chartData.length === 0 && (
        <p className="text-gray-500 text-sm text-center py-8">No data available yet. Stats accumulate daily.</p>
      )}

      {!isLoading && !error && !noneSelected && chartData.length > 0 && (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 mb-3">
            {visibleTeams.map((team) => {
              const color = TEAM_COLORS[allTeams.findIndex(t => t.team_id === team.team_id) % TEAM_COLORS.length]
              return (
                <div key={team.team_id} className="flex items-center gap-1.5">
                  <span className="inline-block w-5 h-0.5 flex-shrink-0" style={{ backgroundColor: color }} />
                  <span className="text-xs text-gray-600 leading-none">{team.team_name}</span>
                </div>
              )
            })}
          </div>
          <ResponsiveContainer width="100%" height={380} minHeight={280}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: -10, bottom: 36 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="date"
                tickFormatter={formatDate}
                tick={{ fontSize: 10 }}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 10 }}
                width={45}
                domain={['auto', 'auto']}
              />
              <Tooltip
                formatter={(value: number, name: string) =>
                  [typeof value === 'number' && !isNaN(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—', name]
                }
                labelFormatter={(label: string) => `Date: ${label}`}
                contentStyle={{ fontSize: 11 }}
              />
              <Brush
                dataKey="date"
                height={28}
                tickFormatter={formatDate}
                travellerWidth={10}
                stroke="#d1d5db"
                fill="#f9fafb"
              />
              {visibleTeams.map((team) => (
                <Line
                  key={team.team_id}
                  type="monotone"
                  dataKey={team.team_name}
                  stroke={TEAM_COLORS[allTeams.findIndex(t => t.team_id === team.team_id) % TEAM_COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  )
}

export default RankingsOverTimeChart

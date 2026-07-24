import { useMemo, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Brush,
  ResponsiveContainer,
  usePlotArea,
  useYAxisScale,
} from 'recharts'
import { useGetRankingsOverTimeQuery } from '../store/api/fantasyApi'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import type { OverTimeSource, TeamTimeSeriesPoint } from '../types/api'

const TEAM_COLORS = [
  '#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed',
  '#db2777', '#0891b2', '#65a30d', '#ea580c', '#9333ea',
  '#0d9488', '#b45309',
]

const DIM_COLOR = '#d1d5db'

type ViewMode = 'points' | 'rank'

const SOURCES: { value: OverTimeSource; label: string }[] = [
  { value: 'rankings_totals', label: 'Rankings by Total' },
  { value: 'rankings_avg', label: 'Rankings by Avg' },
]

type MetricOption = { value: string; label: string }
const METRICS: MetricOption[] = [
  { value: 'rk_total', label: 'Total' },
  { value: 'rk_pts', label: 'PTS' },
  { value: 'rk_reb', label: 'REB' },
  { value: 'rk_ast', label: 'AST' },
  { value: 'rk_stl', label: 'STL' },
  { value: 'rk_blk', label: 'BLK' },
  { value: 'rk_three_pm', label: '3PM' },
  { value: 'rk_fg_pct', label: 'FG%' },
  { value: 'rk_ft_pct', label: 'FT%' },
]

const shortName = (name: string) => (name.length > 14 ? name.slice(0, 13) + '…' : name)
// Tighter truncation for the end-of-line labels so they fit inside the right margin.
const endLabelName = (name: string) => (name.length > 12 ? name.slice(0, 11) + '…' : name)

const formatDate = (dateStr: string) => {
  const d = new Date(dateStr)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function computeBumpRanks(rows: { teamId: number; value: number }[]): Map<number, number> {
  const sorted = [...rows].sort((a, b) => b.value - a.value)
  const ranks = new Map<number, number>()
  let i = 0
  while (i < sorted.length) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1].value === sorted[i].value) j++
    const avgRank = (i + 1 + (j + 1)) / 2
    for (let k = i; k <= j; k++) ranks.set(sorted[k].teamId, avgRank)
    i = j + 1
  }
  return ranks
}

const LABEL_GAP = 13

type Team = { team_id: number; team_name: string }

// End-of-line team labels, rendered as a single coordinated layer so they can be
// spread vertically to avoid overlapping. Reads the live y-scale/plot area from the
// chart, so it stays correct when the Brush zooms into a sub-range.
function EndLabels({
  row,
  teams,
  colorForTeam,
  isOn,
  hasHighlight,
}: {
  row: Record<string, number | string> | undefined
  teams: Team[]
  colorForTeam: (idx: number) => string
  isOn: (teamId: number) => boolean
  hasHighlight: boolean
}) {
  const plot = usePlotArea()
  const yScale = useYAxisScale()
  if (!plot || !yScale || !row) return null

  const labels: { name: string; y: number; color: string }[] = []
  teams.forEach((team, idx) => {
    const on = isOn(team.team_id)
    // When a team is spotlighted, only label the highlighted lines to cut clutter.
    if (hasHighlight && !on) return
    const value = Number(row[team.team_name])
    if (Number.isNaN(value)) return
    const yPix = yScale(value)
    if (yPix == null || Number.isNaN(yPix)) return
    labels.push({
      name: endLabelName(team.team_name),
      y: yPix as number,
      color: on ? colorForTeam(idx) : DIM_COLOR,
    })
  })
  if (labels.length === 0) return null

  // Spread labels so they never overlap: push each one below the previous when too close,
  // then shift the whole stack back inside the plot area if it overflowed.
  labels.sort((a, b) => a.y - b.y)
  for (let i = 1; i < labels.length; i++) {
    if (labels[i].y < labels[i - 1].y + LABEL_GAP) labels[i].y = labels[i - 1].y + LABEL_GAP
  }
  const top = plot.y
  const bottom = plot.y + plot.height
  const overflow = labels[labels.length - 1].y - bottom
  if (overflow > 0) for (const l of labels) l.y -= overflow
  if (labels[0].y < top) {
    const shift = top - labels[0].y
    for (const l of labels) l.y += shift
    for (let i = 1; i < labels.length; i++) {
      if (labels[i].y < labels[i - 1].y + LABEL_GAP) labels[i].y = labels[i - 1].y + LABEL_GAP
    }
  }

  const x = plot.x + plot.width + 6
  return (
    <g>
      {labels.map((l, i) => (
        <text key={i} x={x} y={l.y} fontSize={11} fontWeight={600} fill={l.color} dominantBaseline="middle">
          {l.name}
        </text>
      ))}
    </g>
  )
}

const StandingsRace = () => {
  const [source, setSource] = useState<OverTimeSource>('rankings_totals')
  const [view, setView] = useState<ViewMode>('points')
  const [metric, setMetric] = useState<string>('rk_total')
  const [highlighted, setHighlighted] = useState<Set<number>>(new Set())
  const [brushEnd, setBrushEnd] = useState<number | null>(null)

  const { data, error, isLoading } = useGetRankingsOverTimeQuery({ source })

  const teams = useMemo(() => {
    if (!data) return []
    const seen = new Map<number, string>()
    data.data.forEach(p => { if (!seen.has(p.team_id)) seen.set(p.team_id, p.team_name) })
    return Array.from(seen.entries()).map(([team_id, team_name]) => ({ team_id, team_name }))
  }, [data])

  const teamIdByName = useMemo(() => new Map(teams.map(t => [t.team_name, t.team_id])), [teams])

  const gpByDateTeam = useMemo(() => {
    const m = new Map<string, number | undefined>()
    data?.data.forEach(p => m.set(`${p.date}|${p.team_id}`, p.gp))
    return m
  }, [data])

  const chartData = useMemo(() => {
    if (!data) return []
    const byDate = new Map<string, Record<string, number | string>>()
    data.data.forEach((p: TeamTimeSeriesPoint) => {
      if (!byDate.has(p.date)) byDate.set(p.date, { date: p.date })
      const entry = byDate.get(p.date)!
      const val = p[metric as keyof TeamTimeSeriesPoint]
      entry[p.team_name] = val !== undefined && val !== null ? Number(val) : NaN
    })
    let rows = Array.from(byDate.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)))

    if (view === 'rank') {
      rows = rows.map(row => {
        const dateRows = teams
          .map(t => ({ teamId: t.team_id, value: Number(row[t.team_name]) }))
          .filter(r => !Number.isNaN(r.value))
        const ranks = computeBumpRanks(dateRows)
        const out: Record<string, number | string> = { date: row.date }
        teams.forEach(t => {
          const r = ranks.get(t.team_id)
          out[t.team_name] = r ?? NaN
        })
        return out
      })
    }
    return rows
  }, [data, metric, view, teams])

  const handleViewChange = (next: ViewMode) => {
    setView(next)
    if (next === 'rank') setMetric('rk_total')
  }

  const handleMetricChange = (next: string) => {
    setMetric(next)
    if (next !== 'rk_total' && view === 'rank') setView('points')
  }

  const toggleHighlight = (teamId: number) => {
    setHighlighted(prev => {
      const next = new Set(prev)
      if (next.has(teamId)) next.delete(teamId)
      else next.add(teamId)
      return next
    })
  }
  const clearHighlight = () => setHighlighted(new Set())

  const hasHighlight = highlighted.size > 0
  const isOn = (teamId: number) => !hasHighlight || highlighted.has(teamId)

  // Anchor the end-of-line labels to the last *visible* point so they don't disappear
  // when the Brush zooms to a range that excludes the final date.
  const lastIdx = chartData.length - 1
  const endIdx = brushEnd == null ? lastIdx : Math.min(Math.max(brushEnd, 0), lastIdx)
  const endRow = chartData[endIdx] as Record<string, number | string> | undefined

  return (
    <div>
      <h2 className="text-xl font-semibold mb-1">Standings Race</h2>
      <p className="text-gray-600 dark:text-gray-400 mb-4 text-sm">
        The season's roto race, one line per team. Click a team to spotlight it.
      </p>

      <div>
          <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:flex-wrap sm:items-start">
            <div className="bg-gray-100 dark:bg-gray-700 p-1.5 rounded-lg grid grid-cols-2 gap-1 sm:flex sm:gap-1">
              {SOURCES.map(s => (
                <button
                  key={s.value}
                  onClick={() => setSource(s.value)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 whitespace-nowrap ${
                    source === s.value
                      ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-sm'
                      : 'text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <div className="bg-gray-100 dark:bg-gray-700 p-1.5 rounded-lg grid grid-cols-2 gap-1 sm:flex sm:gap-1">
              {(['points', 'rank'] as ViewMode[]).map(v => (
                <button
                  key={v}
                  onClick={() => handleViewChange(v)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 whitespace-nowrap ${
                    view === v
                      ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-sm'
                      : 'text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100'
                  }`}
                >
                  {v === 'points' ? 'Roto Points' : 'League Rank'}
                </button>
              ))}
            </div>

            <select
              value={metric}
              onChange={e => handleMetricChange(e.target.value)}
              className="border border-gray-300 dark:border-gray-600 rounded-md px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 w-full sm:w-auto"
            >
              {METRICS.map(m => (
                <option key={m.value} value={m.value} disabled={view === 'rank' && m.value !== 'rk_total'}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap gap-x-3 gap-y-1.5 mb-3 overflow-x-auto">
            {teams.map((team, idx) => {
              const color = TEAM_COLORS[idx % TEAM_COLORS.length]
              const on = isOn(team.team_id)
              return (
                <button
                  key={team.team_id}
                  onClick={() => toggleHighlight(team.team_id)}
                  className="flex items-center gap-1.5 shrink-0"
                >
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: on ? color : DIM_COLOR }}
                  />
                  <span className={`text-xs leading-none ${on ? 'text-gray-800 dark:text-gray-100 font-medium' : 'text-gray-400 dark:text-gray-500'}`}>
                    {shortName(team.team_name)}
                  </span>
                </button>
              )
            })}
            {hasHighlight && (
              <button onClick={clearHighlight} className="text-xs text-red-500 hover:text-red-700 font-medium">
                ✕ Clear
              </button>
            )}
          </div>

          {isLoading && <LoadingSpinner />}
          {error && <ErrorMessage message="Failed to load standings history" />}
          {!isLoading && !error && chartData.length === 0 && (
            <p className="text-gray-500 dark:text-gray-400 text-sm text-center py-8">No data available yet. Stats accumulate daily.</p>
          )}

          {!isLoading && !error && chartData.length > 0 && (
            <ResponsiveContainer width="100%" height={420} minHeight={320}>
              <LineChart data={chartData} margin={{ top: 4, right: 84, left: -10, bottom: 36 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:opacity-10" />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDate}
                  tick={{ fontSize: 10 }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  width={45}
                  domain={view === 'rank' ? [1, 12] : ['auto', 'auto']}
                  reversed={view === 'rank'}
                  allowDecimals={view !== 'rank'}
                  ticks={view === 'rank' ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : undefined}
                />
                <Tooltip
                  allowEscapeViewBox={{ x: false, y: true }}
                  position={{ y: 0 }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload || payload.length === 0) return null
                    const dateLabel = String(label)
                    const sorted = [...payload]
                      .filter(e => typeof e.value === 'number' && !isNaN(e.value as number))
                      .sort((a, b) => (view === 'rank' ? (a.value as number) - (b.value as number) : (b.value as number) - (a.value as number)))
                    return (
                      <div style={{ fontSize: 11, background: 'var(--tooltip-bg, #fff)', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 10px', maxHeight: 220, overflowY: 'auto', minWidth: 170 }}
                           className="bg-white dark:bg-gray-800 dark:border-gray-600 text-gray-800 dark:text-gray-100">
                        <p style={{ marginBottom: 4, fontWeight: 600 }}>{formatDate(dateLabel)}</p>
                        {sorted.map(e => {
                          const teamId = teamIdByName.get(String(e.name))
                          const gp = teamId !== undefined ? gpByDateTeam.get(`${dateLabel}|${teamId}`) : undefined
                          return (
                            <div key={e.name} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                              <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: e.color, flexShrink: 0 }} />
                              <span>{e.name}:</span>
                              <span style={{ fontWeight: 600, marginLeft: 'auto', paddingLeft: 8 }}>
                                {(e.value as number).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                              </span>
                              {gp !== undefined && <span style={{ color: '#9ca3af', fontSize: 10 }}>{gp}gp</span>}
                            </div>
                          )
                        })}
                      </div>
                    )
                  }}
                />
                <Brush
                  dataKey="date"
                  height={28}
                  tickFormatter={formatDate}
                  travellerWidth={10}
                  stroke="#d1d5db"
                  fill="#f9fafb"
                  onChange={range => setBrushEnd(range?.endIndex ?? null)}
                />
                {teams.map((team, idx) => {
                  const color = TEAM_COLORS[idx % TEAM_COLORS.length]
                  const on = isOn(team.team_id)
                  return (
                    <Line
                      key={team.team_id}
                      type="monotone"
                      dataKey={team.team_name}
                      stroke={on ? color : DIM_COLOR}
                      strokeWidth={hasHighlight && on ? 3 : 2}
                      strokeOpacity={on ? 0.95 : 0.4}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  )
                })}
                <EndLabels
                  row={endRow}
                  teams={teams}
                  colorForTeam={idx => TEAM_COLORS[idx % TEAM_COLORS.length]}
                  isOn={isOn}
                  hasHighlight={hasHighlight}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
      </div>
    </div>
  )
}

export default StandingsRace

import { useEffect, useMemo, useRef, useState } from 'react'
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
import { getErrorMessage } from '../utils/errorMessage'
import type { OverTimeSource, TeamTimeSeriesPoint } from '../types/api'
import {
  TOTAL_METRIC,
  formatStatValue,
  isPercentCategory,
  metricOptionsFor,
  rankValue,
  statMetricOptionsFor,
  statValue,
  type Basis,
} from './standingsRaceMetrics'
import { useMobileRedesign } from '../mobile/flag'
import { useLiveQuery } from '../hooks/useLiveQuery'
import { liveMoment } from '../utils/live'
import { LIVE_KEY_SUFFIX, liveRaceNote, liveRaceSeries } from '../utils/liveTonight'
import { Chip, Segmented, SelectSheet } from '../mobile/ui'

const TEAM_COLORS = [
  '#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed',
  '#db2777', '#0891b2', '#65a30d', '#ea580c', '#9333ea',
  '#0d9488', '#b45309',
]

const DIM_COLOR = '#d1d5db'

type ViewMode = 'points' | 'value' | 'rank'

const BASES: { value: Basis; label: string }[] = [
  { value: 'avg', label: 'Per Game' },
  { value: 'totals', label: 'Season Totals' },
]

const VIEWS: { value: ViewMode; label: string }[] = [
  { value: 'points', label: 'Roto Points' },
  { value: 'value', label: 'Stat Value' },
  { value: 'rank', label: 'League Rank' },
]

// Basis x view -> the /analytics/over-time source that serves it. League Rank
// is computed client-side from the roto total, so it reads the rankings too.
const sourceFor = (basis: Basis, view: ViewMode): OverTimeSource => {
  if (view === 'value') return basis === 'avg' ? 'averages' : 'snapshot'
  return basis === 'avg' ? 'rankings_avg' : 'rankings_totals'
}

const toggleClass = (on: boolean) =>
  `px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 whitespace-nowrap ${
    on
      ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-sm'
      : 'text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100'
  }`

const GROUP_LABEL = 'text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400'

// Matches the app's Tailwind sans stack closely enough to measure label widths.
const END_LABEL_FONT = '600 11px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

// Measure rendered text width with a shared offscreen canvas so we can size the label
// gutter to the real text and truncate at word boundaries instead of mid-word.
let measureCanvas: HTMLCanvasElement | null = null
const measureText = (text: string): number => {
  if (typeof document === 'undefined') return text.length * 6.2 // SSR fallback
  if (!measureCanvas) measureCanvas = document.createElement('canvas')
  const ctx = measureCanvas.getContext('2d')
  if (!ctx) return text.length * 6.2
  ctx.font = END_LABEL_FONT
  return ctx.measureText(text).width
}

// Show the full name if it fits; otherwise drop whole trailing words (never cutting a
// word in half). Only a single word longer than the space falls back to a hard cut.
const fitLabel = (name: string, maxWidth: number): string => {
  if (measureText(name) <= maxWidth) return name
  const words = name.split(/\s+/)
  for (let n = words.length - 1; n >= 1; n--) {
    const candidate = words.slice(0, n).join(' ') + '…'
    if (measureText(candidate) <= maxWidth) return candidate
  }
  let s = words[0]
  while (s.length > 1 && measureText(s + '…') > maxWidth) s = s.slice(0, -1)
  return s + '…'
}

// "YYYY-MM-DD" is a calendar day: read its parts rather than new Date(),
// which parses it as UTC midnight and shows the previous day west of UTC.
const formatDate = (dateStr: string) => {
  const [, month, day] = dateStr.slice(0, 10).split('-').map(Number)
  return `${month}/${day}`
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
  labelFor,
  valueText,
  gap = 6,
}: {
  row: Record<string, number | string> | undefined
  teams: Team[]
  colorForTeam: (idx: number) => string
  isOn: (teamId: number) => boolean
  hasHighlight: boolean
  labelFor: (teamName: string) => string
  valueText?: (value: number) => string
  /** Space before the labels; wider while tonight's hollow point sits at the edge. */
  gap?: number
}) {
  const plot = usePlotArea()
  const yScale = useYAxisScale()
  if (!plot || !yScale || !row) return null

  const labels: { name: string; value?: string; y: number; color: string }[] = []
  teams.forEach((team, idx) => {
    const on = isOn(team.team_id)
    // When a team is spotlighted, only label the highlighted lines to cut clutter.
    if (hasHighlight && !on) return
    const value = Number(row[team.team_name])
    if (Number.isNaN(value)) return
    const yPix = yScale(value)
    if (yPix == null || Number.isNaN(yPix)) return
    labels.push({
      name: labelFor(team.team_name),
      value: valueText?.(value),
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

  const x = plot.x + plot.width + gap
  return (
    <g>
      {labels.map((l, i) => (
        <text key={i} x={x} y={l.y} fontSize={11} fontWeight={600} fill={l.color} dominantBaseline="middle">
          {l.name}
          {l.value !== undefined && (
            <tspan fontWeight={400} className="fill-gray-700 dark:fill-gray-300">{` ${l.value}`}</tspan>
          )}
        </text>
      ))}
    </g>
  )
}


const StandingsRace = () => {
  const mobile = useMobileRedesign()
  const [basis, setBasis] = useState<Basis>('avg')
  const [view, setView] = useState<ViewMode>('points')
  const [metric, setMetric] = useState<string>(TOTAL_METRIC)
  const [highlighted, setHighlighted] = useState<Set<number>>(new Set())
  // The Brush's range, tagged with the source it was dragged on: a new source
  // brings new dates, and the Brush itself remounts (key) to the full range.
  const [brush, setBrush] = useState<{ source: OverTimeSource; start: number; end: number } | null>(null)

  // Track the chart's rendered width so we can size the end-label gutter to the real
  // text — full names when they fit, word-boundary truncation when they don't.
  const wrapRef = useRef<HTMLDivElement>(null)
  const [wrapWidth, setWrapWidth] = useState(0)

  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setWrapWidth(e.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const source = sourceFor(basis, view)
  const isValueView = view === 'value'
  // currentData, not data: while a new source loads, data still holds the
  // previous source's payload, which would be charted under the new labels.
  const { currentData: data, error, isFetching } = useLiveQuery(useGetRankingsOverTimeQuery, { source })
  // Tonight's dashed point (plan: "a dashed live point for tonight"), only while
  // tonight is live or final-but-unofficial; ESPN's update replaces it with a stored point.
  const moment = liveMoment(data?.live)
  const livePoints = useMemo(() => (moment && data?.live_points?.length ? data.live_points : []), [moment, data])
  const liveDate = livePoints[0]?.date ?? null
  const raceNote = liveDate ? liveRaceNote(data?.live) : null

  const teams = useMemo(() => {
    if (!data) return []
    const seen = new Map<number, string>()
    data.data.forEach(p => { if (!seen.has(p.team_id)) seen.set(p.team_id, p.team_name) })
    return Array.from(seen.entries()).map(([team_id, team_name]) => ({ team_id, team_name }))
  }, [data])

  const teamIdByName = useMemo(() => new Map(teams.map(t => [t.team_name, t.team_id])), [teams])

  const metricOptions = useMemo(
    () => (isValueView ? statMetricOptionsFor(data?.data, data?.categories) : metricOptionsFor(data?.data)),
    [data, isValueView],
  )

  // A selected category can vanish between payloads (source switch, a league
  // that stops scoring it, Stat Value having no Total). Derived rather than
  // corrected in an effect, so no render ever charts a metric the data doesn't carry.
  const activeMetric = useMemo(() => {
    if (metricOptions.some(m => m.value === metric)) return metric
    if (!isValueView) return TOTAL_METRIC
    return metricOptions.find(m => m.value === 'PTS')?.value ?? metricOptions[0]?.value ?? 'PTS'
  }, [metricOptions, metric, isValueView])

  const lowerIsBetter = isValueView && (data?.reverse_categories ?? []).includes(activeMetric)
  // Season totals only ever grow, so a change arrow there says nothing.
  const showDeltas = !(isValueView && basis === 'totals')

  const formatValue = (v: number) =>
    isValueView
      ? formatStatValue(v, activeMetric, basis)
      : v.toLocaleString(undefined, { maximumFractionDigits: 1 })

  const gpByDateTeam = useMemo(() => {
    const m = new Map<string, number | undefined>()
    data?.data.forEach(p => m.set(`${p.date}|${p.team_id}`, p.gp))
    livePoints.forEach(p => m.set(`${p.date}|${p.team_id}`, p.gp))
    return m
  }, [data, livePoints])

  const chartData = useMemo(() => {
    if (!data) return []
    const byDate = new Map<string, Record<string, number | string>>()
    data.data.concat(livePoints).forEach((p: TeamTimeSeriesPoint) => {
      if (!byDate.has(p.date)) byDate.set(p.date, { date: p.date })
      const entry = byDate.get(p.date)!
      entry[p.team_name] = isValueView ? statValue(p, activeMetric) : rankValue(p, activeMetric)
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
    return liveRaceSeries(rows, liveDate, teams.map(t => t.team_name))
  }, [data, livePoints, liveDate, activeMetric, view, isValueView, teams])

  // A row's value for a team, stored or tonight's (the live row keeps it under the dashed key).
  const valueOf = (row: Record<string, number | string> | undefined, name: string) =>
    row === undefined ? undefined : (row[name] ?? row[name + LIVE_KEY_SUFFIX])
  const withLiveValues = (row: Record<string, number | string> | undefined) => {
    if (!row || row.date !== liveDate) return row
    const out: Record<string, number | string> = { date: row.date }
    teams.forEach(t => { const v = valueOf(row, t.team_name); if (v !== undefined) out[t.team_name] = v })
    return out
  }
  const liveTick = moment === 'final' ? 'Tonight' : 'Live'
  const tickText = (d: string) => (d === liveDate ? liveTick : formatDate(d))

  const handleBasisChange = (next: Basis) => setBasis(next)

  const handleViewChange = (next: ViewMode) => {
    setView(next)
    if (next === 'rank') setMetric(TOTAL_METRIC)
    // Stat Value has no Total; keep a category the user picked, else start on PTS.
    if (next === 'value' && metric === TOTAL_METRIC) setMetric('PTS')
  }

  const handleMetricChange = (next: string) => {
    setMetric(next)
    if (next !== TOTAL_METRIC && view === 'rank') setView('points')
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

  // The Brush's visible range. Change arrows compare against its first day, and
  // the end-of-line labels anchor to its last day so they don't vanish when the
  // Brush zooms to a range that excludes the final date.
  const lastIdx = chartData.length - 1
  const clampIdx = (i: number) => Math.min(Math.max(i, 0), Math.max(lastIdx, 0))
  const range = brush && brush.source === source ? brush : null
  const startIdx = range ? clampIdx(range.start) : 0
  const endIdx = range ? clampIdx(range.end) : lastIdx
  const startRow = chartData[startIdx] as Record<string, number | string> | undefined
  const endRow = withLiveValues(chartData[endIdx] as Record<string, number | string> | undefined)

  // Reserve enough gutter to show full team names, but keep the plot dominant —
  // especially on phones, where the graph matters more than fitting every full name.
  // The cap is a small share of the width, so on mobile names trim at a word boundary
  // rather than shrinking the chart; on wider screens full names fit comfortably.
  // In Stat Value the label also carries the team's number, which gets room first.
  const { labelGutter, fittedNames } = useMemo(() => {
    const width = wrapWidth || 360
    const lastRow = withLiveValues(chartData[chartData.length - 1])
    const valueWidth = isValueView && lastRow
      ? teams.reduce((max, t) => {
          const v = Number(lastRow[t.team_name])
          return Number.isNaN(v) ? max : Math.max(max, measureText(` ${formatStatValue(v, activeMetric, basis)}`))
        }, 0)
      : 0
    const longest = teams.reduce((max, t) => Math.max(max, measureText(t.team_name)), 0)
    const maxGutter = Math.min(Math.max(width * 0.22, 76), 200) + valueWidth
    // 8px inner padding on each side of the label text.
    const gutter = Math.round(Math.min(longest + valueWidth + 16, maxGutter))
    const maxTextWidth = Math.max(gutter - 12 - valueWidth, 24)
    const fitted = new Map(teams.map(t => [t.team_name, fitLabel(t.team_name, maxTextWidth)]))
    return { labelGutter: gutter, fittedNames: fitted }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams, wrapWidth, chartData, isValueView, activeMetric, basis, liveDate])
  const labelFor = (teamName: string) => fittedNames.get(teamName) ?? teamName

  const basisWord = basis === 'avg' ? 'per-game averages' : 'season totals'
  let caption: string
  if (view === 'rank') caption = `League position by total roto points, ranked on ${basisWord}`
  else if (view === 'points')
    caption = `${activeMetric === TOTAL_METRIC ? 'Total roto points' : `${activeMetric} roto points`}, ranked on ${basisWord}`
  else if (isPercentCategory(activeMetric)) caption = `Season ${activeMetric} as of each day`
  else if (basis === 'avg') caption = `${activeMetric} per game: each team's season average as of each day`
  else caption = `Season total ${activeMetric}, accumulated day by day`
  if (lowerIsBetter) caption += ' (lower is better)'

  const yTickFormatter = (v: number) => {
    if (!isValueView) return String(v)
    if (isPercentCategory(activeMetric)) return formatStatValue(v, activeMetric, basis)
    return v.toLocaleString(undefined, { maximumFractionDigits: 2 })
  }

  // Positive = the team got better: a higher value, or a smaller rank number
  // (and for a reverse-scored category like TO, a lower value).
  const improvement = (from: number, to: number) => (view === 'rank' || lowerIsBetter ? from - to : to - from)
  const formatDelta = (d: number) => (isValueView ? formatStatValue(Math.abs(d), activeMetric, basis) : formatValue(Math.abs(d)))

  const chart = (
    <>
          {isFetching && !data && <LoadingSpinner />}
          {error && <ErrorMessage message={getErrorMessage(error, 'Failed to load standings history')} />}
          {!isFetching && !error && chartData.length === 0 && (
            <p className="text-gray-500 dark:text-gray-400 text-sm text-center py-8">No data available yet. Stats accumulate daily.</p>
          )}

          {data && !error && chartData.length > 0 && (
            <>
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-2">{caption}</p>
            <ResponsiveContainer width="100%" height={mobile ? 340 : 420} minHeight={320}>
              <LineChart data={chartData} margin={{ top: 4, right: labelGutter, left: -10, bottom: 36 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:opacity-10" />
                <XAxis
                  dataKey="date"
                  tickFormatter={tickText}
                  tick={liveDate ? (props: { x?: number | string; y?: number | string; payload?: { value?: unknown } }) => (
                    <text
                      x={Number(props.x)}
                      y={Number(props.y) + 12}
                      textAnchor="middle"
                      fontSize={10}
                      fontWeight={props.payload?.value === liveDate ? 700 : 400}
                      className={props.payload?.value === liveDate ? 'fill-emerald-700 dark:fill-emerald-400' : 'fill-gray-500 dark:fill-gray-400'}
                    >
                      {tickText(String(props.payload?.value ?? ''))}
                    </text>
                  ) : { fontSize: 10 }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  width={isValueView && basis === 'totals' ? 55 : 45}
                  domain={view === 'rank' ? [1, 12] : ['auto', 'auto']}
                  reversed={view === 'rank' || lowerIsBetter}
                  allowDecimals={view !== 'rank'}
                  ticks={view === 'rank' ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : undefined}
                  tickFormatter={yTickFormatter}
                />
                <Tooltip
                  allowEscapeViewBox={{ x: false, y: true }}
                  position={{ y: 0 }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload || payload.length === 0) return null
                    const dateLabel = String(label)
                    // Both the solid and the dashed line report the last stored day: one row per team.
                    const seenNames = new Set<string>()
                    payload = payload.filter(e => (seenNames.has(String(e.name)) ? false : (seenNames.add(String(e.name)), true)))
                    const startDate = startRow ? String(startRow.date) : undefined
                    const withDeltas = showDeltas && startDate !== undefined && startDate < dateLabel
                    const sorted = [...payload]
                      .filter(e => typeof e.value === 'number' && !isNaN(e.value as number))
                      .sort((a, b) => (view === 'rank' || lowerIsBetter ? (a.value as number) - (b.value as number) : (b.value as number) - (a.value as number)))
                    return (
                      <div style={{ fontSize: 11, background: 'var(--tooltip-bg, #fff)', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 10px', maxHeight: 240, overflowY: 'auto', minWidth: 190 }}
                           className="bg-white dark:bg-gray-800 dark:border-gray-600 text-gray-800 dark:text-gray-100">
                        <p style={{ marginBottom: 4, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <span style={{ fontWeight: 600 }}>{dateLabel === liveDate ? `${formatDate(dateLabel)} · ${moment === 'final' ? 'tonight' : 'live'}` : formatDate(dateLabel)}</span>
                          {withDeltas && <span className="text-gray-500 dark:text-gray-400">vs {formatDate(startDate!)}</span>}
                        </p>
                        {sorted.map(e => {
                          const teamId = teamIdByName.get(String(e.name))
                          const gp = teamId !== undefined ? gpByDateTeam.get(`${dateLabel}|${teamId}`) : undefined
                          const from = startRow ? Number(startRow[String(e.name)]) : NaN
                          const delta = withDeltas && !Number.isNaN(from) ? improvement(from, e.value as number) : NaN
                          const deltaText = formatDelta(delta)
                          const unchanged = Number.isNaN(delta) ? false : Number(deltaText.replace(/[^0-9.]/g, '')) === 0
                          return (
                            <div key={e.name} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                              <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: e.color, flexShrink: 0 }} />
                              <span>{e.name}:</span>
                              <span style={{ fontWeight: 600, marginLeft: 'auto', paddingLeft: 8 }}>
                                {formatValue(e.value as number)}
                              </span>
                              {withDeltas && (
                                <span
                                  style={{ minWidth: 44, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                                  className={
                                    Number.isNaN(delta) || unchanged
                                      ? 'text-gray-500 dark:text-gray-400'
                                      : delta > 0
                                        ? 'text-green-700 dark:text-green-400'
                                        : 'text-red-700 dark:text-red-400'
                                  }
                                >
                                  {Number.isNaN(delta) ? '' : unchanged ? '0' : `${delta > 0 ? '▲' : '▼'}${deltaText}`}
                                </span>
                              )}
                              {gp !== undefined && gp !== null && <span style={{ color: '#9ca3af', fontSize: 10 }}>{gp}gp</span>}
                            </div>
                          )
                        })}
                      </div>
                    )
                  }}
                />
                <Brush
                  key={source}
                  dataKey="date"
                  height={28}
                  tickFormatter={tickText}
                  travellerWidth={10}
                  stroke="#d1d5db"
                  fill="#f9fafb"
                  onChange={r => {
                    if (r && r.startIndex !== undefined && r.endIndex !== undefined) {
                      setBrush({ source, start: r.startIndex, end: r.endIndex })
                    }
                  }}
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
                {liveDate && teams.map((team, idx) => {
                  const color = TEAM_COLORS[idx % TEAM_COLORS.length]
                  const on = isOn(team.team_id)
                  const stroke = on ? color : DIM_COLOR
                  return (
                    <Line
                      key={`${team.team_id}-tonight`}
                      type="linear"
                      name={team.team_name}
                      dataKey={team.team_name + LIVE_KEY_SUFFIX}
                      stroke={stroke}
                      strokeWidth={hasHighlight && on ? 3 : 2}
                      strokeOpacity={on ? 0.95 : 0.4}
                      strokeDasharray="5 4"
                      legendType="none"
                      isAnimationActive={false}
                      activeDot={false}
                      dot={(props: { cx?: number; cy?: number; index?: number; payload?: Record<string, unknown> }) =>
                        props.payload?.date === liveDate && props.cx != null && props.cy != null
                          ? <circle key={`live-dot-${team.team_id}`} data-testid="race-live-point" cx={props.cx} cy={props.cy} r={4.5} fill="#ffffff" stroke={stroke} strokeWidth={2} />
                          : <g key={`no-dot-${team.team_id}-${props.index}`} />}
                    />
                  )
                })}
                <EndLabels
                  row={endRow}
                  teams={teams}
                  colorForTeam={idx => TEAM_COLORS[idx % TEAM_COLORS.length]}
                  isOn={isOn}
                  hasHighlight={hasHighlight}
                  labelFor={labelFor}
                  valueText={isValueView ? v => formatStatValue(v, activeMetric, basis) : undefined}
                  gap={liveDate ? 10 : 6}
                />
              </LineChart>
            </ResponsiveContainer>
            {raceNote && (
              <p data-testid="race-live-note" className="text-xs text-emerald-700 dark:text-emerald-400 mt-1">{raceNote}</p>
            )}
            {showDeltas && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                ▲/▼ in the tooltip: how much each team improved or slipped since the first day of the selected range.
                {isValueView && isPercentCategory(activeMetric) && ` ${activeMetric} is a season percentage, so Per Game and Season Totals show the same line.`}
              </p>
            )}
            </>
          )}
    </>
  )

  if (mobile) {
    return (
      <div ref={wrapRef} className="mr-race">
        <h2 className="mr-h2">Standings Race</h2>
        <p className="mr-meta" style={{ margin: 0 }}>The season's roto race, one line per team. Tap a team to spotlight it.</p>
        <div className="mr-race-lab">
          <span className="mr-meta">Basis</span>
          <Segmented label="Basis" size="sm" options={BASES} value={basis} onChange={handleBasisChange} />
        </div>
        <div className="mr-race-lab">
          <span className="mr-meta">Show</span>
          <Segmented label="Show" size="sm" options={VIEWS} value={view} onChange={handleViewChange} />
        </div>
        <div className="mr-race-lab">
          <span className="mr-meta">Category</span>
          <SelectSheet
            id="race-category"
            label="Category"
            wide
            // League Rank only charts the total (desktop greys the others out).
            options={view === 'rank' ? metricOptions.filter(m => m.value === TOTAL_METRIC) : metricOptions}
            value={activeMetric}
            onChange={handleMetricChange}
          />
        </div>
        <div className="mr-race-chart">{chart}</div>
        <div className="mr-race-teams" role="group" aria-label="Spotlight teams">
          {teams.map((team, idx) => {
            const on = isOn(team.team_id)
            return (
              <Chip
                key={team.team_id}
                selected={highlighted.has(team.team_id)}
                className={on ? undefined : 'mr-race-off'}
                onClick={() => toggleHighlight(team.team_id)}
              >
                <span className="mr-race-dot" style={{ backgroundColor: on ? TEAM_COLORS[idx % TEAM_COLORS.length] : DIM_COLOR }} aria-hidden="true" />
                {team.team_name}
              </Chip>
            )
          })}
          {hasHighlight && (
            <Chip onClick={clearHighlight}>✕ Clear</Chip>
          )}
        </div>
        <p className="mr-meta" style={{ margin: 0 }}>Drag the range bar under the chart to zoom into dates.</p>
      </div>
    )
  }

  return (
    <div ref={wrapRef}>
      <h2 className="text-xl font-semibold mb-1">Standings Race</h2>
      <p className="text-gray-600 dark:text-gray-400 mb-4 text-sm">
        The season's roto race, one line per team. Click a team to spotlight it.
      </p>

      <div>
          <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="flex flex-col gap-1">
              <span className={GROUP_LABEL}>Basis</span>
              <div className="bg-gray-100 dark:bg-gray-700 p-1.5 rounded-lg grid grid-cols-2 gap-1 sm:flex sm:gap-1">
                {BASES.map(b => (
                  <button
                    key={b.value}
                    aria-pressed={basis === b.value}
                    onClick={() => handleBasisChange(b.value)}
                    className={toggleClass(basis === b.value)}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className={GROUP_LABEL}>Show</span>
              <div className="bg-gray-100 dark:bg-gray-700 p-1.5 rounded-lg grid grid-cols-3 gap-1 sm:flex sm:gap-1">
                {VIEWS.map(v => (
                  <button
                    key={v.value}
                    aria-pressed={view === v.value}
                    onClick={() => handleViewChange(v.value)}
                    className={toggleClass(view === v.value)}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="standings-race-category" className={GROUP_LABEL}>Category</label>
              <select
                id="standings-race-category"
                value={activeMetric}
                onChange={e => handleMetricChange(e.target.value)}
                className="border border-gray-300 dark:border-gray-600 rounded-md px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 w-full sm:w-auto"
              >
                {metricOptions.map(m => (
                  <option key={m.value} value={m.value} disabled={view === 'rank' && m.value !== TOTAL_METRIC}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
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
                  <span className={`text-xs leading-none whitespace-nowrap ${on ? 'text-gray-800 dark:text-gray-100 font-medium' : 'text-gray-400 dark:text-gray-500'}`}>
                    {team.team_name}
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

          {chart}
      </div>
    </div>
  )
}

export default StandingsRace

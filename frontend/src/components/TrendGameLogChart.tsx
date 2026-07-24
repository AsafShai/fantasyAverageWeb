import { useMemo } from 'react'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useGetTrendGameLogQuery } from '../store/api/fantasyApi'
import LoadingSpinner from './LoadingSpinner'
import ErrorMessage from './ErrorMessage'
import type { GameLogEntry, GameLogResponse, RegressionStat } from '../types/api'
import { BASELINE_LABEL } from '../utils/trendBaseline'

export type GameLogMode = 'minutes' | 'usage' | 'shooting'

const ROLLING_GAMES = 5

const STAT_FIELDS: Record<RegressionStat, { made: keyof GameLogEntry; att: keyof GameLogEntry; label: string }> = {
  '3P%': { made: 'fg3m', att: 'fg3a', label: '3PM' },
  'FT%': { made: 'ftm', att: 'fta', label: 'FTM' },
  'FG%': { made: 'fgm', att: 'fga', label: 'FGM' },
}

function shortDate(iso: string): string {
  return iso.slice(5).replace('-', '/')
}

interface ChartRow {
  date: string
  label: string
  matchup: string
  value: number      // plotted value, capped at the axis ceiling
  trueValue: number  // what actually happened, always shown in the tooltip
  capped: boolean
  bar: number
  rawPct: number | null
  minutes: number
}

function buildRows(log: GameLogResponse, mode: GameLogMode, stat: RegressionStat): ChartRow[] {
  return log.games.map((g, i) => {
    const base = { date: g.game_date, label: shortDate(g.game_date), matchup: g.matchup, minutes: g.min, capped: false }
    if (mode === 'minutes') {
      return { ...base, value: g.min, trueValue: g.min, bar: 0, rawPct: null }
    }
    if (mode === 'usage') {
      return { ...base, value: g.usg, trueValue: g.usg, bar: g.min, rawPct: null }
    }
    const { made, att } = STAT_FIELDS[stat]
    const from = Math.max(0, i - ROLLING_GAMES + 1)
    const slice = log.games.slice(from, i + 1)
    const madeSum = slice.reduce((s, x) => s + (x[made] as number), 0)
    const attSum = slice.reduce((s, x) => s + (x[att] as number), 0)
    const attempts = g[att] as number
    const rolling = attSum ? (madeSum / attSum) * 100 : 0
    return {
      ...base,
      value: rolling,
      trueValue: rolling,
      bar: attempts,
      rawPct: attempts ? ((g[made] as number) / attempts) * 100 : null,
    }
  })
}

function percentile(sorted: number[], q: number): number {
  const i = (sorted.length - 1) * q
  const lo = Math.floor(i), hi = Math.ceil(i)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)
}

const OUTLIER_HEADROOM = 1.35

// USG% is a rate per minute on court, so a 2-minute cameo with one shot scores
// as if that pace held for a whole game and lands north of 100. The axis must
// not scale to those or the real trend flattens — but it must never cut off the
// bottom or a legitimately low game vanishes. So: floor is always the true
// minimum, ceiling only backs off when the top outliers sit far above the 95th
// percentile, and any point above it is capped and marked rather than clipped.
function chartScale(values: number[], refs: number[]): { domain: [number, number]; cap: number } {
  const sorted = [...values].sort((a, b) => a - b)
  const dataMin = sorted[0]
  const dataMax = sorted[sorted.length - 1]
  const p95 = percentile(sorted, 0.95)

  const cap = dataMax > p95 * OUTLIER_HEADROOM ? p95 * OUTLIER_HEADROOM : dataMax

  let lo = dataMin
  let hi = cap
  for (const r of refs) { lo = Math.min(lo, r); hi = Math.max(hi, r) }
  const pad = (hi - lo || 1) * 0.08
  return { domain: [Math.max(0, lo - pad), hi + pad], cap }
}

function CappedDot(props: { cx?: number; cy?: number; payload?: ChartRow; stroke?: string }) {
  const { cx, cy, payload, stroke } = props
  if (cx === undefined || cy === undefined) return null
  if (!payload?.capped) return <circle cx={cx} cy={cy} r={2} fill={stroke} />
  return <path d={`M${cx - 4},${cy + 3} L${cx},${cy - 3} L${cx + 4},${cy + 3} Z`} fill={stroke} />
}

function StatBlock({ rows }: { rows: [string, string][] }) {
  return (
    <div className="flex flex-row sm:flex-col flex-wrap gap-x-4 gap-y-1 sm:w-48 sm:flex-none justify-center">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3 text-xs border-b border-dashed border-gray-200 dark:border-gray-700 pb-0.5 flex-1 sm:flex-none min-w-[45%] sm:min-w-0">
          <span className="text-gray-500 dark:text-gray-400">{k}</span>
          <span className="text-gray-800 dark:text-gray-200 font-medium whitespace-nowrap">{v}</span>
        </div>
      ))}
    </div>
  )
}

function ChartTooltip({ active, payload, mode, stat }: {
  active?: boolean
  payload?: { payload: ChartRow }[]
  mode: GameLogMode
  stat: RegressionStat
}) {
  if (!active || !payload?.length) return null
  const r = payload[0].payload
  const unit = mode === 'minutes' ? ' min' : '%'
  const main = mode === 'minutes' ? 'MPG' : mode === 'usage' ? 'USG' : `${stat} (${ROLLING_GAMES}g)`
  return (
    <div className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1.5 text-[11px] shadow">
      <div className="font-semibold text-gray-800 dark:text-gray-100">{r.label} · {r.matchup}</div>
      <div className="text-gray-600 dark:text-gray-300">{main}: {r.trueValue.toFixed(1)}{unit}</div>
      {r.capped && <div className="text-amber-600 dark:text-amber-400">above the axis — {r.minutes.toFixed(0)} min played</div>}
      {mode === 'usage' && <div className="text-gray-500 dark:text-gray-400">MIN: {r.bar.toFixed(0)}</div>}
      {mode === 'shooting' && (
        <div className="text-gray-500 dark:text-gray-400">
          This game: {r.rawPct === null ? 'no attempts' : `${r.rawPct.toFixed(0)}% on ${r.bar}`}
        </div>
      )}
    </div>
  )
}

interface Props {
  playerId: number
  playerName: string
  mode: GameLogMode
  windowDays: number
  baselineSeasons?: number
  stat?: RegressionStat
  availableStats?: RegressionStat[]
  onStatChange?: (stat: RegressionStat) => void
}

export default function TrendGameLogChart({
  playerId, playerName, mode, windowDays, baselineSeasons = 2, stat = '3P%', availableStats = [], onStatChange,
}: Props) {
  const { data: log, isLoading, error } = useGetTrendGameLogQuery({ playerId, windowDays, baselineSeasons })

  const rows = useMemo(() => (log ? buildRows(log, mode, stat) : []), [log, mode, stat])

  if (isLoading) return <div className="py-6"><LoadingSpinner /></div>
  if (error) return <ErrorMessage message={`Could not load ${playerName}'s game log.`} />
  if (!log || rows.length === 0) {
    return <p className="py-4 text-xs text-gray-500 dark:text-gray-400">No games on record for {playerName} this season.</p>
  }

  const windowRows = rows.filter(r => r.date >= log.window_start)
  const bandStart = windowRows.length ? windowRows[0].label : null
  const bandEnd = rows[rows.length - 1].label

  const seasonRef = mode === 'minutes' ? log.season_mpg : mode === 'usage' ? log.season_usg : log.season_pct[stat]
  const baselineRef = mode === 'shooting' ? log.baseline_pct[stat] : undefined
  const unit = mode === 'minutes' ? '' : '%'

  const { domain, cap } = chartScale(
    rows.map(r => r.value),
    [seasonRef, baselineRef].filter((v): v is number => v !== undefined),
  )
  const cappedRows = rows.map(r => (r.value > cap ? { ...r, value: cap, capped: true } : r))
  const cappedCount = cappedRows.filter(r => r.capped).length

  const windowMean = windowRows.length
    ? windowRows.reduce((s, r) => s + r.value, 0) / windowRows.length
    : null

  const statRows: [string, string][] =
    mode === 'minutes'
      ? [
          ['Season MPG', log.season_mpg.toFixed(1)],
          [`${windowDays}d MPG`, windowMean === null ? '—' : windowMean.toFixed(1)],
          ['Games', String(log.season_gp)],
        ]
      : mode === 'usage'
        ? [
            ['Season USG%', `${log.season_usg.toFixed(1)}%`],
            [`${windowDays}d USG%`, windowMean === null ? '—' : `${windowMean.toFixed(1)}%`],
            ['Season MPG', log.season_mpg.toFixed(1)],
            ['Games', String(log.season_gp)],
          ]
        : [
            [`Season ${stat}`, seasonRef === undefined ? '—' : `${seasonRef.toFixed(1)}%`],
            [`Baseline (${BASELINE_LABEL[log.baseline_seasons] ?? `${log.baseline_seasons} seasons`})`,
              baselineRef === undefined ? 'no prior data' : `${baselineRef.toFixed(1)}%`],
            ['Δ vs baseline',
              baselineRef === undefined || seasonRef === undefined
                ? '—'
                : `${seasonRef - baselineRef >= 0 ? '+' : ''}${(seasonRef - baselineRef).toFixed(1)}%`],
            ['Games', String(log.season_gp)],
          ]

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-xs text-gray-500 dark:text-gray-400 mr-auto">
          {playerName} —{' '}
          {mode === 'minutes' && 'minutes per game'}
          {mode === 'usage' && 'usage rate per game, bars = minutes'}
          {mode === 'shooting' && `${stat}, ${ROLLING_GAMES}-game attempt-weighted · bars = attempts`}
        </span>
        {mode === 'shooting' && availableStats.length > 1 && (
          <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden text-[11px]">
            {availableStats.map(s => (
              <button
                key={s}
                onClick={e => { e.stopPropagation(); onStatChange?.(s) }}
                className={`px-2.5 py-1 ${s === stat ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {cappedCount > 0 && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400 mb-1">
          ▲ {cappedCount} {cappedCount === 1 ? 'game sits' : 'games sit'} above the axis — short garbage-time
          appearances where a per-minute rate overstates the real role. Hover for the true value.
        </p>
      )}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch">
        <div className="w-full min-w-0 flex-none h-[150px] sm:flex-1 sm:h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={cappedRows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--trend-grid)" />
              <XAxis dataKey="label" tick={{ fontSize: 9 }} interval="preserveStartEnd" minTickGap={24} />
              <YAxis yAxisId="main" tick={{ fontSize: 9 }} domain={domain} allowDataOverflow width={34} tickFormatter={(v: number) => v.toFixed(0)} />
              <YAxis yAxisId="bar" orientation="right" hide domain={[0, (max: number) => max * 3]} />
              <Tooltip content={<ChartTooltip mode={mode} stat={stat} />} />
              {bandStart && (
                <ReferenceArea
                  yAxisId="main"
                  x1={bandStart}
                  x2={bandEnd}
                  fill="var(--trend-band)"
                  label={{ value: `last ${windowDays}d`, position: 'insideTop', fontSize: 9, fill: 'var(--trend-band-label)' }}
                />
              )}
              {mode !== 'minutes' && <Bar yAxisId="bar" dataKey="bar" fill="#8b5cf6" fillOpacity={0.45} isAnimationActive={false} />}
              {seasonRef !== undefined && (
                <ReferenceLine
                  yAxisId="main"
                  y={seasonRef}
                  stroke="var(--trend-season-line)"
                  strokeWidth={1.5}
                  strokeDasharray="6 3"
                  ifOverflow="extendDomain"
                  label={{ value: `season ${seasonRef.toFixed(1)}${unit}`, position: 'insideTopLeft', fontSize: 9, fontWeight: 600, fill: 'var(--trend-season-line)' }}
                />
              )}
              {baselineRef !== undefined && (
                <ReferenceLine
                  yAxisId="main"
                  y={baselineRef}
                  stroke="#ef4444"
                  strokeDasharray="2 3"
                  strokeWidth={1.5}
                  ifOverflow="extendDomain"
                  label={{ value: `baseline ${baselineRef.toFixed(1)}%`, position: 'insideBottomRight', fontSize: 9, fontWeight: 600, fill: '#ef4444' }}
                />
              )}
              <Line
                yAxisId="main"
                type="monotone"
                dataKey="value"
                stroke={mode === 'minutes' ? '#3b82f6' : mode === 'usage' ? '#f59e0b' : '#10b981'}
                strokeWidth={2}
                dot={<CappedDot />}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <StatBlock rows={statRows} />
      </div>
    </div>
  )
}

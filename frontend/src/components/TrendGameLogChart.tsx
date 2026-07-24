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
  value: number
  bar: number
  rawPct: number | null
}

function buildRows(log: GameLogResponse, mode: GameLogMode, stat: RegressionStat): ChartRow[] {
  return log.games.map((g, i) => {
    if (mode === 'minutes') {
      return { date: g.game_date, label: shortDate(g.game_date), matchup: g.matchup, value: g.min, bar: 0, rawPct: null }
    }
    if (mode === 'usage') {
      return { date: g.game_date, label: shortDate(g.game_date), matchup: g.matchup, value: g.usg, bar: g.min, rawPct: null }
    }
    const { made, att } = STAT_FIELDS[stat]
    const from = Math.max(0, i - ROLLING_GAMES + 1)
    const slice = log.games.slice(from, i + 1)
    const madeSum = slice.reduce((s, x) => s + (x[made] as number), 0)
    const attSum = slice.reduce((s, x) => s + (x[att] as number), 0)
    const attempts = g[att] as number
    return {
      date: g.game_date,
      label: shortDate(g.game_date),
      matchup: g.matchup,
      value: attSum ? (madeSum / attSum) * 100 : 0,
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

// A garbage-time game (2 minutes, one shot) produces a USG% north of 100 and a
// single-game shooting % of 0 or 100. Scaling to those makes the actual trend a
// flat line, so the axis covers the 5th-95th percentile and outliers clip.
function robustDomain(values: number[], refs: number[]): [number, number] {
  const sorted = [...values].sort((a, b) => a - b)
  let lo = percentile(sorted, 0.05)
  let hi = percentile(sorted, 0.95)
  for (const r of refs) { lo = Math.min(lo, r); hi = Math.max(hi, r) }
  const pad = (hi - lo || 1) * 0.15
  return [Math.max(0, lo - pad), hi + pad]
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
      <div className="text-gray-600 dark:text-gray-300">{main}: {r.value.toFixed(1)}{unit}</div>
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

  const domain = robustDomain(
    rows.map(r => r.value),
    [seasonRef, baselineRef].filter((v): v is number => v !== undefined),
  )

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

      <div className="flex flex-col sm:flex-row gap-3 items-stretch">
        <div className="w-full min-w-0 flex-none h-[150px] sm:flex-1 sm:h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-gray-200 dark:text-gray-700" />
              <XAxis dataKey="label" tick={{ fontSize: 9 }} interval="preserveStartEnd" minTickGap={24} />
              <YAxis yAxisId="main" tick={{ fontSize: 9 }} domain={domain} allowDataOverflow width={34} tickFormatter={(v: number) => v.toFixed(0)} />
              <YAxis yAxisId="bar" orientation="right" hide domain={[0, (max: number) => max * 3]} />
              <Tooltip content={<ChartTooltip mode={mode} stat={stat} />} />
              {bandStart && (
                <ReferenceArea
                  yAxisId="main"
                  x1={bandStart}
                  x2={bandEnd}
                  fill="#3b82f6"
                  fillOpacity={0.12}
                  label={{ value: `last ${windowDays}d`, position: 'insideTop', fontSize: 9, fill: '#3b82f6' }}
                />
              )}
              {mode !== 'minutes' && <Bar yAxisId="bar" dataKey="bar" fill="#8b5cf6" fillOpacity={0.45} isAnimationActive={false} />}
              {seasonRef !== undefined && (
                <ReferenceLine
                  yAxisId="main"
                  y={seasonRef}
                  stroke="#9ca3af"
                  strokeDasharray="5 4"
                  label={{ value: `season ${seasonRef.toFixed(1)}${unit}`, position: 'insideTopRight', fontSize: 9, fill: '#9ca3af' }}
                />
              )}
              {baselineRef !== undefined && (
                <ReferenceLine
                  yAxisId="main"
                  y={baselineRef}
                  stroke="#ef4444"
                  strokeDasharray="2 3"
                  label={{ value: `baseline ${baselineRef.toFixed(1)}%`, position: 'insideBottomLeft', fontSize: 9, fill: '#ef4444' }}
                />
              )}
              <Line
                yAxisId="main"
                type="monotone"
                dataKey="value"
                stroke={mode === 'minutes' ? '#3b82f6' : mode === 'usage' ? '#f59e0b' : '#10b981'}
                strokeWidth={2}
                dot={{ r: 2 }}
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

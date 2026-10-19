import { useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { AccuracyWeek, CategoryAccuracy } from '../../types/api'
import { formatError, formatShortDate, isPctCategory } from '../../utils/modelAccuracy'

interface Point {
  week: string
  model: number | null
  baseline: number | null
  games: number
}

function TrendTooltip({ active, payload, catKey }: { active?: boolean; payload?: { payload: Point }[]; catKey: string }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow px-3 py-2 text-xs">
      <div className="font-semibold mb-1">Week of {p.week}</div>
      <div className="flex items-center gap-2 tabular-nums">
        <svg width="14" height="4" aria-hidden="true"><line x1="0" y1="2" x2="14" y2="2" stroke="var(--accuracy-model)" strokeWidth="2" /></svg>
        <b>{formatError(p.model, catKey)}</b> <span className="text-gray-500 dark:text-gray-400">model</span>
      </div>
      <div className="flex items-center gap-2 tabular-nums">
        <svg width="14" height="4" aria-hidden="true"><line x1="0" y1="2" x2="14" y2="2" stroke="var(--accuracy-baseline)" strokeWidth="2" strokeDasharray="4 3" /></svg>
        <b>{formatError(p.baseline, catKey)}</b> <span className="text-gray-500 dark:text-gray-400">last-10 avg</span>
      </div>
      <div className="text-gray-500 dark:text-gray-400 mt-1">{p.games.toLocaleString()} player-games</div>
    </div>
  )
}

const WeeklyTrendChart = ({ weeks, categories }: { weeks: AccuracyWeek[]; categories: Pick<CategoryAccuracy, 'key' | 'label'>[] }) => {
  const [catKey, setCatKey] = useState(categories[0]?.key ?? 'pts')
  const data: Point[] = weeks.map(w => ({
    week: formatShortDate(w.week_start),
    model: w.categories[catKey]?.model_mae ?? null,
    baseline: w.categories[catKey]?.baseline_mae ?? null,
    games: w.games,
  }))
  const digits = isPctCategory(catKey) ? 0 : 1

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-3" role="group" aria-label="Trend category">
        {categories.map(c => (
          <button
            key={c.key}
            type="button"
            aria-pressed={c.key === catKey}
            onClick={() => setCatKey(c.key)}
            className={`text-xs rounded-full px-2.5 py-0.5 border ${
              c.key === catKey
                ? 'bg-blue-600 border-blue-600 text-white font-semibold'
                : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-300 mb-1">
        <span className="inline-flex items-center gap-1.5">
          <svg width="16" height="4" aria-hidden="true"><line x1="0" y1="2" x2="16" y2="2" stroke="var(--accuracy-model)" strokeWidth="2" /></svg>Model
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="16" height="4" aria-hidden="true"><line x1="0" y1="2" x2="16" y2="2" stroke="var(--accuracy-baseline)" strokeWidth="2" strokeDasharray="4 3" /></svg>Last-10 average
        </span>
        <span className="text-gray-500 dark:text-gray-400">Mean absolute error per game{isPctCategory(catKey) ? ' (pct. points)' : ''}; axis does not start at 0</span>
      </div>
      {data.length < 2 ? (
        <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">The trend appears once two weeks have graded games.</p>
      ) : (
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--trend-grid)" vertical={false} />
              <XAxis dataKey="week" tick={{ fontSize: 11, fill: 'currentColor' }} className="text-gray-500 dark:text-gray-400" />
              <YAxis
                domain={['auto', 'auto']}
                tickFormatter={(v: number) => v.toFixed(digits)}
                tick={{ fontSize: 11, fill: 'currentColor' }}
                className="text-gray-500 dark:text-gray-400"
              />
              <Tooltip content={<TrendTooltip catKey={catKey} />} />
              <Line type="linear" dataKey="baseline" stroke="var(--accuracy-baseline)" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
              <Line type="linear" dataKey="model" stroke="var(--accuracy-model)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

export default WeeklyTrendChart

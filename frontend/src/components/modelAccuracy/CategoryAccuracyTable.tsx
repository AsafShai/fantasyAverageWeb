import type { CategoryAccuracy } from '../../types/api'
import { errorDeltaPct, formatBand, formatError, formatSigned } from '../../utils/modelAccuracy'

const BAR_W = 220
const BAR_H = 22
const MAX_PCT = 20

/** Error vs baseline on one shared ±20% scale: left of the line = model better. */
function DeltaBar({ delta }: { delta: number | null }) {
  const mid = BAR_W / 2
  if (delta == null) return <span className="text-gray-400">—</span>
  const len = (Math.min(Math.abs(delta), MAX_PCT) / MAX_PCT) * (mid - 4)
  const better = delta < 0
  const x = better ? mid - len : mid
  return (
    <svg viewBox={`0 0 ${BAR_W} ${BAR_H}`} width="100%" height={BAR_H} className="max-w-[220px]" role="img" aria-label={`${formatSigned(delta)}% vs baseline`}>
      <line x1={mid} x2={mid} y1={0} y2={BAR_H} stroke="var(--accuracy-zero)" />
      <rect x={x} y={5} width={Math.max(len, 1.5)} height={12} rx={3} fill={better ? 'var(--accuracy-pos)' : 'var(--accuracy-neg)'} />
      <text
        x={better ? Math.max(x - 4, 30) : x + len + 4}
        y={15}
        textAnchor={better ? 'end' : 'start'}
        className="fill-gray-600 dark:fill-gray-300 text-[11px]"
      >
        {formatSigned(delta)}%
      </text>
    </svg>
  )
}

const CategoryAccuracyTable = ({ categories }: { categories: CategoryAccuracy[] }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead>
        <tr className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
          <th className="text-left font-medium px-2 py-1.5">Category</th>
          <th className="text-right font-medium px-2 py-1.5 whitespace-nowrap">Model error</th>
          <th className="text-right font-medium px-2 py-1.5 whitespace-nowrap">Last-10 avg error</th>
          <th className="text-left font-medium px-2 py-1.5 min-w-[180px]">Error vs. baseline</th>
          <th className="text-right font-medium px-2 py-1.5 whitespace-nowrap">Hit rate</th>
          <th className="text-right font-medium px-2 py-1.5">Games</th>
        </tr>
      </thead>
      <tbody>
        {categories.map(c => (
          <tr key={c.key} className="border-b last:border-0 border-gray-100 dark:border-gray-700/60">
            <td className="px-2 py-2 font-semibold text-gray-900 dark:text-gray-100">{c.label}</td>
            <td className="px-2 py-2 text-right tabular-nums">{formatError(c.model_mae, c.key)}</td>
            <td className="px-2 py-2 text-right tabular-nums text-gray-500 dark:text-gray-400">{formatError(c.baseline_mae, c.key)}</td>
            <td className="px-2 py-1"><DeltaBar delta={errorDeltaPct(c)} /></td>
            <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">
              {c.hit_rate == null ? '—' : `${Math.round(c.hit_rate * 100)}%`}{' '}
              <span className="text-xs text-gray-500 dark:text-gray-400">{formatBand(c.band, c.key)}</span>
            </td>
            <td className="px-2 py-2 text-right tabular-nums text-gray-500 dark:text-gray-400">{c.games.toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)

export default CategoryAccuracyTable

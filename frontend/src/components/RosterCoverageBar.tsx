import { coverageBarPlayingSplit } from '../utils/rosterCoverage'

export function RosterCoverageBar({
  rosterSize,
  count,
  b2bCount,
  className = '',
}: {
  rosterSize: number
  count: number
  b2bCount: number
  className?: string
}) {
  const { totalPct, b2bInsidePct, nonB2bInsidePct } = coverageBarPlayingSplit(rosterSize, count, b2bCount)
  const allB2b = count > 0 && b2bCount >= count

  return (
    <div className={`relative h-full w-6 overflow-hidden rounded-t bg-blue-100 dark:bg-blue-950/50 ${className}`.trim()}>
      {totalPct > 0 ? (
        <div
          className={`absolute inset-x-0 bottom-0 overflow-hidden ${allB2b ? 'rounded-t bg-orange-400 dark:bg-orange-600' : 'rounded-t bg-blue-600'}`}
          style={{ height: `${totalPct}%` }}
        >
          {!allB2b && b2bInsidePct > 0 ? (
            <div
              className="absolute inset-x-0 bottom-0 border-t border-blue-800/30 bg-orange-400 dark:border-blue-300/25 dark:bg-orange-600"
              style={{ height: `${b2bInsidePct}%` }}
            />
          ) : null}
          {!allB2b && nonB2bInsidePct > 0 ? (
            <div className="absolute inset-x-0 top-0 bg-blue-600" style={{ height: `${nonB2bInsidePct}%` }} />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

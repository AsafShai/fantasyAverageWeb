import { Link } from 'react-router'
import InfoTip from './InfoTip'
import { CATEGORY_LABELS, type PlayerRankSummary, type RankingCategory } from '../utils/playerRankings'

// Bars saturate at ±Z_CAP so one outlier category doesn't flatten the rest.
const Z_CAP = 2.5

function zTone(z: number, neutralBand = 0.5): string {
  if (z >= neutralBand) return 'text-green-600 dark:text-green-400'
  if (z <= -neutralBand) return 'text-red-500 dark:text-red-400'
  return 'text-gray-600 dark:text-gray-300'
}

function signed(z: number): string {
  return `${z >= 0 ? '+' : ''}${z.toFixed(2)}`
}

function ZBar({ label, z, ariaLabel }: { label: string; z: number; ariaLabel: string }) {
  const width = (Math.min(Math.abs(z), Z_CAP) / Z_CAP) * 50
  const positive = z >= 0
  return (
    <div className="flex items-center gap-2 sm:gap-3" aria-label={ariaLabel}>
      <span className="w-10 shrink-0 text-xs font-semibold text-gray-600 dark:text-gray-300">{label}</span>
      <div className="relative flex-1 h-2.5 rounded-full bg-gray-100 dark:bg-gray-800" aria-hidden="true">
        <div className="absolute inset-y-0 left-1/2 w-px bg-gray-300 dark:bg-gray-600" />
        <div
          className={`absolute inset-y-0 rounded-full ${positive ? 'bg-green-500/80 dark:bg-green-500/70' : 'bg-red-500/80 dark:bg-red-500/70'}`}
          style={positive ? { left: '50%', width: `${width}%` } : { right: '50%', width: `${width}%` }}
        />
      </div>
      <span className={`w-12 shrink-0 text-right font-mono text-xs tabular-nums ${zTone(z)}`}>{signed(z)}</span>
    </div>
  )
}

interface Props {
  positions: string[]
  summary: PlayerRankSummary | null
  categories: RankingCategory[]
  loading: boolean
}

export default function PlayerFantasyValueCard({ positions, summary, categories, loading }: Props) {
  if (loading) {
    return (
      <div className="mb-6 bg-white dark:bg-gray-900 rounded-lg shadow border border-gray-200 dark:border-gray-700 p-4 sm:p-6 animate-pulse" data-testid="fantasy-value-skeleton">
        <div className="h-5 w-40 bg-gray-200 dark:bg-gray-700 rounded mb-4" />
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[0, 1, 2].map(i => <div key={i} className="h-16 bg-gray-200 dark:bg-gray-700 rounded-lg" />)}
        </div>
        <div className="space-y-2">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-3 bg-gray-200 dark:bg-gray-700 rounded" />)}
        </div>
      </div>
    )
  }

  const realPositions = positions.filter(p => p && p !== 'Unknown')
  const ranked = summary?.rank != null

  return (
    <section
      aria-labelledby="fantasy-value-heading"
      className="mb-6 bg-white dark:bg-gray-900 rounded-lg shadow border border-gray-200 dark:border-gray-700 p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 id="fantasy-value-heading" className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
          Fantasy Value
        </h2>
        <Link
          to="/player-rankings"
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
        >
          Full rankings →
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
        <div className="col-span-2 sm:col-span-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 px-3 py-2.5">
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">ESPN eligibility</div>
          {realPositions.length > 0 ? (
            <div className="flex flex-wrap gap-1.5" aria-label="ESPN position eligibility">
              {realPositions.map(pos => (
                <span
                  key={pos}
                  className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold tracking-wide bg-indigo-100 text-indigo-700 border border-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300 dark:border-indigo-800"
                >
                  {pos}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-sm text-gray-400">—</span>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 px-3 py-2.5">
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-0.5">Overall rank</div>
          {summary ? (
            ranked ? (
              <div data-testid="fantasy-rank">
                <span className="text-2xl font-bold text-gray-900 dark:text-gray-100 tabular-nums">#{summary.rank}</span>
                <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">of {summary.poolSize}</span>
              </div>
            ) : (
              <div data-testid="fantasy-rank" className="text-sm font-semibold text-gray-600 dark:text-gray-300 pt-1">
                Outside top {summary.poolSize}
              </div>
            )
          ) : (
            <div className="text-2xl font-bold text-gray-400">—</div>
          )}
          {summary && summary.positionRanks.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
              {summary.positionRanks.map(({ position, rank }) => (
                <span key={position} className="whitespace-nowrap">
                  <span className="font-semibold text-gray-700 dark:text-gray-200">#{rank}</span> {position}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 px-3 py-2.5">
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-0.5 inline-flex items-center gap-1">
            Z-score
            <InfoTip
              title="Z-score"
              body="Average of this player's per-category z-scores vs. the ranked pool. 0 is average; higher is better."
              formula="Season · per game · equal weights"
            />
          </div>
          {summary ? (
            <div data-testid="fantasy-z" className={`text-2xl font-bold tabular-nums ${zTone(summary.totalZ, 0.25)}`}>
              {signed(summary.totalZ)}
            </div>
          ) : (
            <div className="text-2xl font-bold text-gray-400">—</div>
          )}
        </div>
      </div>

      {summary ? (
        <>
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Category z-scores</h3>
            <span className="text-[11px] text-gray-400 dark:text-gray-500">Season · per game</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
            {categories.map(cat => {
              const label = CATEGORY_LABELS[cat] ?? cat
              const z = summary.zScores[cat] ?? 0
              return <ZBar key={cat} label={label} z={z} ariaLabel={`${label} z-score ${signed(z)}`} />
            })}
          </div>
        </>
      ) : (
        <p className="text-sm text-gray-400 dark:text-gray-500">
          No season stats yet, so there's no rank or z-score for this player.
        </p>
      )}
    </section>
  )
}

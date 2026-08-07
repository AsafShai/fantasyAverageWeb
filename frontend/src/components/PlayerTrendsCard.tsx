import { useMemo, useState } from 'react'
import { useGetTrendGameLogQuery } from '../store/api/fantasyApi'
import TrendGameLogChart from './TrendGameLogChart'
import type { RegressionStat } from '../types/api'
import { FF_TRENDS } from '../config/featureFlags'
import { LOW_SAMPLE_GP } from '../utils/trendBaseline'
import { STAT_FIELDS, seasonAttempts, summarize, fmtValue, fmtDelta, type CardMode } from '../utils/playerTrendsSummary'

const WINDOW_DAYS = 15

const MODE_CHIPS: { key: CardMode; label: string }[] = [
  { key: 'minutes', label: 'Minutes' },
  { key: 'usage', label: 'Usage' },
  { key: '3P%', label: '3P%' },
  { key: 'FT%', label: 'FT%' },
  { key: 'FG%', label: 'FG%' },
]

function shortDate(iso: string): string {
  return iso.slice(5).replace('-', '/')
}

function Tile({ label, value, games, muted, badge }: {
  label: string
  value: string
  games?: number
  muted?: boolean
  badge?: string
}) {
  return (
    <div
      className={`rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-3 py-2 min-w-0 ${
        muted ? 'opacity-60' : ''
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</span>
        {badge && (
          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
            {badge}
          </span>
        )}
      </div>
      <div className="text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">{value}</div>
      {games !== undefined && (
        <div className="text-[11px] text-gray-500 dark:text-gray-400">{games} {games === 1 ? 'game' : 'games'}</div>
      )}
    </div>
  )
}

function Skeleton() {
  return (
    <div className="h-[300px] sm:h-[320px] animate-pulse">
      <div className="h-5 w-40 bg-gray-200 dark:bg-gray-700 rounded mb-4" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-16 bg-gray-200 dark:bg-gray-700 rounded-lg" />
        ))}
      </div>
      <div className="h-[180px] bg-gray-200 dark:bg-gray-700 rounded-lg" />
    </div>
  )
}

interface Props {
  playerId: number
}

export default function PlayerTrendsCard({ playerId }: Props) {
  const [mode, setMode] = useState<CardMode>('minutes')

  const { data: log, error, isLoading, refetch } = useGetTrendGameLogQuery(
    { playerId, windowDays: WINDOW_DAYS, baselineSeasons: 0, mode: 'form' },
    { skip: !playerId, refetchOnFocus: false },
  )

  const availableShootingStats = useMemo(() => {
    if (!log) return []
    return (Object.keys(STAT_FIELDS) as RegressionStat[]).filter((s) => seasonAttempts(log.games, s) > 0)
  }, [log])

  if (!FF_TRENDS) return null

  const is404 = error && 'status' in error && error.status === 404

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg shadow border border-gray-200 dark:border-gray-700 p-6 mt-6">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">Trends</h2>

      {isLoading && <Skeleton />}

      {!isLoading && error && (
        <div className="h-[300px] sm:h-[320px] flex items-center justify-center text-center px-4">
          {is404 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No game log this season.</p>
          ) : (
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Failed to load trends.{' '}
              <button
                type="button"
                onClick={() => refetch()}
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                Retry
              </button>
            </div>
          )}
        </div>
      )}

      {!isLoading && !error && log && (
        <>
          <div className="flex flex-wrap gap-2 mb-4">
            {MODE_CHIPS.filter(
              (c) => c.key === 'minutes' || c.key === 'usage' || availableShootingStats.includes(c.key as RegressionStat),
            ).map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setMode(c.key)}
                className={`px-3 py-1.5 text-sm rounded-lg border whitespace-nowrap transition-colors ${
                  mode === c.key
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          {(() => {
            const summary = summarize(log, mode)
            const partial = summary.windowGames < LOW_SAMPLE_GP
            return (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <Tile label="Season" value={fmtValue(summary.seasonValue, mode)} games={summary.seasonGames} />
                <Tile label={`Last ${WINDOW_DAYS}d`} value={fmtValue(summary.windowValue, mode)} games={summary.windowGames} />
                <Tile
                  label="Δ vs season"
                  value={fmtDelta(summary.delta, mode)}
                  games={summary.windowGames}
                  muted={partial}
                  badge={partial ? 'partial' : undefined}
                />
                <Tile label="Window start" value={shortDate(summary.windowStart)} games={summary.windowGames} />
              </div>
            )
          })()}

          <TrendGameLogChart
            playerId={playerId}
            playerName={log.player_name}
            mode={mode === 'minutes' || mode === 'usage' ? mode : 'shooting'}
            regressionMode="form"
            windowDays={WINDOW_DAYS}
            baselineSeasons={0}
            stat={mode === 'minutes' || mode === 'usage' ? undefined : mode}
            qualifiedStats={availableShootingStats}
          />
        </>
      )}
    </div>
  )
}

import { useState } from 'react'
import TrendGameLogChart from '../../components/TrendGameLogChart'
import type { CountingCategory, CustomDateRange, TimePeriod } from '../../types/api'
import { LOW_SAMPLE_GP } from '../../utils/trendBaseline'
import { summarize, fmtValue, fmtDelta, type CardMode } from '../../utils/playerTrendsSummary'
import { isCountingCategory, isGoodChange } from '../../utils/categoryTrends'
import { usePlayerTrends } from '../../hooks/usePlayerTrends'
import { Card } from '../ui'

const MODE_LABEL: Partial<Record<CardMode, string>> = { minutes: 'Minutes', usage: 'Usage' }

interface Props {
  playerId: number
  categories?: string[]
  reverseCategories?: string[]
  timePeriod: TimePeriod
  customRange: CustomDateRange | null
}

/**
 * Trends on a phone: the same stat tiles as desktop (recent window vs season,
 * colored change), three across; tapping one opens its game-by-game chart.
 */
export default function TrendsCard({ playerId, categories, reverseCategories, timePeriod, customRange }: Props) {
  // which stat's chart is open; tapping the open one again closes it
  const [mode, setMode] = useState<CardMode | null>('minutes')
  const { log, error, is404, isLoading, refetch, windowDays, fallback, availableShootingStats, modes, reverse } =
    usePlayerTrends({ playerId, categories, reverseCategories, timePeriod, customRange })

  let body
  if (isLoading) {
    body = <div className="mr-pp-skel mr-pp-skel-tall" aria-hidden="true" />
  } else if (error) {
    body = is404 ? (
      <p className="mr-meta mr-pp-empty">No game log this season.</p>
    ) : (
      <p className="mr-meta mr-pp-empty">
        Failed to load trends.{' '}
        <button type="button" className="mr-link" onClick={() => refetch()}>
          Retry
        </button>
      </p>
    )
  } else if (log) {
    const windowGames = log.games.filter((g) => g.game_date >= log.window_start).length
    const partial = windowGames < LOW_SAMPLE_GP
    body = (
      <>
        <span className="mr-meta">
          Last {windowDays} days vs season · {windowGames} {windowGames === 1 ? 'game' : 'games'}
          {partial && <span className="mr-pp-partial">partial</span>}
          {fallback &&
            (fallback === 'season'
              ? '. Full Season has no recent stretch to compare, so Trends shows the last 15 days.'
              : '. Trends compares a stretch that ends on the latest game day, so for this range it shows the last 15 days.')}
        </span>
        <span className="mr-meta">Tap a stat for its game-by-game chart</span>
        <div className="mr-pp-tiles mr-c3">
          {modes.map((key) => {
            const s = summarize(log, key)
            const open = mode === key
            const moved = s.delta !== null && Math.abs(s.delta) >= 0.05
            const good = s.delta !== null && (isCountingCategory(key) ? isGoodChange(s.delta, key, reverse) : s.delta >= 0)
            const deltaCls = !moved ? '' : good ? 'mr-pp-d-good' : 'mr-pp-d-bad'
            const label = MODE_LABEL[key] ?? key
            return (
              <button
                key={key}
                type="button"
                className="mr-pp-tile mr-pp-tb"
                aria-expanded={open}
                onClick={() => setMode(open ? null : key)}
                aria-label={`${label}: last ${windowDays} days ${fmtValue(s.windowValue, key)}, change ${fmtDelta(s.delta, key)}. ${open ? 'Close the chart' : 'Show the game-by-game chart'}`}
              >
                <span className="mr-pp-tl mr-pp-tl-row">
                  {label}
                  <span className="mr-pp-arrow" aria-hidden="true">▶</span>
                </span>
                <span className="mr-pp-tv">{fmtValue(s.windowValue, key)}</span>
                <span className={`mr-pp-d ${deltaCls}`}>{fmtDelta(s.delta, key)}</span>
              </button>
            )
          })}
        </div>
        {mode && (
          <div className="mr-pp-chart">
            <TrendGameLogChart
              playerId={playerId}
              playerName={log.player_name}
              mode={mode === 'minutes' || mode === 'usage' ? mode : isCountingCategory(mode) ? 'category' : 'shooting'}
              regressionMode="form"
              windowDays={windowDays}
              baselineSeasons={0}
              stat={mode === 'minutes' || mode === 'usage' || isCountingCategory(mode) ? undefined : mode}
              qualifiedStats={availableShootingStats}
              category={isCountingCategory(mode) ? (mode as CountingCategory) : undefined}
            />
          </div>
        )}
      </>
    )
  }

  return (
    <Card title="Trends" aria-label="Trends">
      {body}
    </Card>
  )
}

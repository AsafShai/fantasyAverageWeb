import { useState } from 'react'
import {
  useGetAllPlayersQuery,
  useGetModelAccuracyMissesQuery,
  useGetModelAccuracyPlayersQuery,
  useGetModelAccuracySummaryQuery,
  useGetModelAccuracyWeeklyQuery,
} from '../store/api/fantasyApi'
import type { AccuracyMode, AccuracySummary, AccuracyWindow } from '../types/api'
import { useMyTeam } from '../context/MyTeamContext'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import { getErrorMessage } from '../utils/errorMessage'
import CategoryAccuracyTable from '../components/modelAccuracy/CategoryAccuracyTable'
import WeeklyTrendChart from '../components/modelAccuracy/WeeklyTrendChart'
import MissesList from '../components/modelAccuracy/MissesList'
import PlayersAccuracyTable from '../components/modelAccuracy/PlayersAccuracyTable'
import DidNotPlayList from '../components/modelAccuracy/DidNotPlayList'
import {
  WINDOW_LABELS,
  filterByRoster,
  formatShortDate,
  headline,
  type PlayerFilter,
} from '../utils/modelAccuracy'

const MODE_LABELS: Record<AccuracyMode, string> = {
  pregame: 'Pre-game projections',
  retro: 'Given actual minutes',
}

const CARD = 'bg-white dark:bg-gray-900 rounded-lg shadow border border-gray-200 dark:border-gray-700 p-4'

function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string
  value: T
  options: Record<T, string>
  onChange: (v: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex border border-gray-300 dark:border-gray-600 rounded overflow-hidden">
      {(Object.keys(options) as T[]).map((key, i) => (
        <button
          key={key}
          type="button"
          aria-pressed={key === value}
          onClick={() => onChange(key)}
          className={`px-3 py-1.5 text-sm whitespace-nowrap ${i > 0 ? 'border-l border-gray-300 dark:border-gray-600' : ''} ${
            key === value
              ? 'bg-blue-600 text-white font-medium'
              : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
          }`}
        >
          {options[key]}
        </button>
      ))}
    </div>
  )
}

function ModeBanner({ mode, summary }: { mode: AccuracyMode; summary?: AccuracySummary }) {
  const since = summary?.first_snapshot_date ? formatShortDate(summary.first_snapshot_date) : null
  return (
    <div className="flex gap-2.5 items-start text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md px-3 py-2">
      {mode === 'pregame' ? (
        <>
          <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/40 rounded px-1.5 py-0.5">Pre-game</span>
          <span>
            Compares the projection exactly as shown before tip-off (projected minutes included) with the final box score.
            {since ? ` Snapshots began ${since}; numbers firm up as games accumulate.` : ' Snapshots start with the next slate.'}
            {summary && summary.dnp > 0 ? ` ${summary.dnp.toLocaleString()} projected players didn't play and aren't in the averages.` : ''}
          </span>
        </>
      ) : (
        <>
          <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-gray-600 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded px-1.5 py-0.5">Given minutes</span>
          <span>
            Re-predicts each game after the fact using the minutes the player actually played, so it measures per-minute
            skill only and errors are smaller than what you saw pre-game. Not what the Projections page showed. The
            baseline gets the same help: last-10 per-minute rates × actual minutes.
          </span>
        </>
      )}
    </div>
  )
}

function Tile({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: 'good' }) {
  return (
    <div className="min-w-0 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 px-3 sm:px-4 py-3 grid gap-0.5 content-start">
      <span className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</span>
      <span className={`text-xl sm:text-2xl font-bold ${tone === 'good' ? 'text-emerald-700 dark:text-emerald-400' : 'text-gray-900 dark:text-gray-100'}`}>{value}</span>
      <span className="text-xs text-gray-600 dark:text-gray-300">{detail}</span>
    </div>
  )
}

function SummaryTiles({ summary }: { summary: AccuracySummary }) {
  const h = headline(summary.categories)
  const pts = summary.categories.find(c => c.key === 'pts')
  const min = summary.minutes
  return (
    <section aria-label="Headline numbers" className="grid gap-3 grid-cols-2 lg:grid-cols-4">
      <Tile label="Categories beating baseline" value={`${h.beating} of ${h.graded}`} detail="Lower error than the last-10 average" />
      <Tile
        label="Avg. error reduction"
        value={h.avgReduction == null ? '—' : `${h.avgReduction.toFixed(1)}%`}
        detail="vs. last-10 average, mean over categories"
        tone={h.avgReduction != null && h.avgReduction > 0 ? 'good' : undefined}
      />
      <Tile
        label="PTS within ±4"
        value={pts?.hit_rate == null ? '—' : `${Math.round(pts.hit_rate * 100)}%`}
        detail={`of ${summary.games.toLocaleString()} player-games`}
      />
      {min ? (
        <Tile
          label="Minutes error"
          value={min.model_mae == null ? '—' : `${min.model_mae.toFixed(1)} min`}
          detail={`last-5 default vs. actual · baseline ${min.baseline_mae?.toFixed(1) ?? '—'}`}
        />
      ) : (
        <Tile label="Minutes" value="Given" detail="This mode uses actual minutes, so minutes error is not measured" />
      )}
    </section>
  )
}

const ModelAccuracy = () => {
  const [mode, setMode] = useState<AccuracyMode>('pregame')
  const [win, setWin] = useState<AccuracyWindow>('season')
  const { myTeamId } = useMyTeam()
  const [playerFilter, setPlayerFilter] = useState<PlayerFilter>(myTeamId != null ? 'mine' : 'rostered')

  const summaryQ = useGetModelAccuracySummaryQuery({ mode, window: win })
  const weeklyQ = useGetModelAccuracyWeeklyQuery(mode)
  const missesQ = useGetModelAccuracyMissesQuery()
  const playersQ = useGetModelAccuracyPlayersQuery()
  const { data: allPlayers } = useGetAllPlayersQuery({ page: 1, limit: 1200 })

  const summary = summaryQ.data
  const hasGames = Boolean(summary && summary.games > 0)
  const playerRows = filterByRoster(playersQ.data?.players ?? [], allPlayers?.players, playerFilter, myTeamId)
  const filterOptions: Partial<Record<PlayerFilter, string>> = {
    ...(myTeamId != null ? { mine: 'My team' } : {}),
    rostered: 'All rostered',
    all: 'All players',
  }

  return (
    <div className="max-w-6xl mx-auto px-4 grid grid-cols-[minmax(0,1fr)] gap-5 pb-10">
      <section className="flex flex-wrap gap-3 items-end justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">Model vs. Reality</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 max-w-2xl">
            How close our per-game projections came to what players actually did, compared with simply using each
            player's last-10-game average.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Segmented label="Accuracy mode" value={mode} options={MODE_LABELS} onChange={setMode} />
          <Segmented label="Window" value={win} options={WINDOW_LABELS} onChange={setWin} />
        </div>
      </section>

      <ModeBanner mode={mode} summary={summary} />

      {summaryQ.isLoading ? (
        <LoadingSpinner />
      ) : summaryQ.error ? (
        <ErrorMessage message={getErrorMessage(summaryQ.error, 'Failed to load accuracy summary')} />
      ) : !hasGames || !summary ? (
        <div className={`${CARD} text-center py-10 text-sm text-gray-600 dark:text-gray-300`}>
          {mode === 'pregame' ? (
            <>
              <p className="font-medium text-gray-900 dark:text-gray-100">No graded pre-game projections yet.</p>
              <p className="mt-1">Results appear the morning after the first snapshotted slate is played.</p>
              <button type="button" onClick={() => setMode('retro')} className="mt-3 text-blue-600 dark:text-blue-400 hover:underline">
                See given-minutes accuracy instead
              </button>
            </>
          ) : (
            <p>No graded games in this window yet.</p>
          )}
        </div>
      ) : (
        <>
          <SummaryTiles summary={summary} />
          <section className={CARD}>
            <div className="flex flex-wrap gap-2 justify-between items-baseline mb-3">
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Accuracy by category</h2>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {WINDOW_LABELS[win]}
                {summary.start && summary.end ? ` · ${formatShortDate(summary.start)} – ${formatShortDate(summary.end)}` : ''}
                {` · ${summary.games.toLocaleString()} player-games`}
              </span>
            </div>
            <CategoryAccuracyTable categories={summary.categories} />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2.5">
              Error is mean absolute error per game. Hit rate is the share of games within the band shown. FG% and FT%
              count only games with 5+ FGA / 2+ FTA. A negative gap (bar left of the line) means the model beat the baseline.
            </p>
          </section>
        </>
      )}

      {hasGames && summary && (
        <section className={CARD}>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-3">Weekly trend</h2>
          {weeklyQ.data ? <WeeklyTrendChart weeks={weeklyQ.data.weeks} categories={summary.categories} /> : <LoadingSpinner />}
        </section>
      )}

      {mode === 'pregame' && missesQ.data && (missesQ.data.misses.length > 0 || missesQ.data.didnt_play.length > 0) && (
        <section className={CARD}>
          <div className="flex flex-wrap gap-2 justify-between items-baseline mb-3">
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
              Biggest misses{missesQ.data?.week_start ? `, week of ${formatShortDate(missesQ.data.week_start)}` : ''}
            </h2>
            <span className="text-xs text-gray-500 dark:text-gray-400">Games played, ranked by total miss across counting stats. Reason shown when the data explains it.</span>
          </div>
          <div className="grid gap-5">
            {missesQ.data.misses.length > 0 && <MissesList misses={missesQ.data.misses} />}
            {missesQ.data.didnt_play.length > 0 && (
              <DidNotPlayList rows={missesQ.data.didnt_play} total={missesQ.data.didnt_play_count} />
            )}
          </div>
        </section>
      )}

      {mode === 'pregame' && (playersQ.data?.players.length ?? 0) > 0 && (
        <section className={CARD}>
          <div className="flex flex-wrap gap-2 justify-between items-center mb-3">
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Players vs. their projections</h2>
            <Segmented label="Player filter" value={playerFilter} options={filterOptions as Record<PlayerFilter, string>} onChange={setPlayerFilter} />
          </div>
          {playerRows.length ? (
            <PlayersAccuracyTable rows={playerRows} />
          ) : (
            <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">No players with 3+ graded games for this filter yet.</p>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2.5">
            Each bar is one game; bars above the line beat the projection, bars below trailed it (summed over PTS,
            REB, AST, 3PM, STL and BLK in spread units). "Beating" / "Trailing" means at least 5 of the last 8 games went
            that way and the average is beyond ±0.5. Most out-of-line players first.
          </p>
        </section>
      )}
    </div>
  )
}

export default ModelAccuracy

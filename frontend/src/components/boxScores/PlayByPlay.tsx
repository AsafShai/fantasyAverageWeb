import { useState } from 'react'
import type { BoxPlay, GameBoxScore } from '../../types/boxScore'

type PlayFilter = 'all' | 'scoring'

function periodName(period: number): string {
  if (period >= 1 && period <= 4) return `Q${period}`
  if (period === 5) return 'OT'
  if (period > 5) return `${period - 4}OT`
  return 'Other'
}

function teamColor(color: string): string | undefined {
  return /^[0-9A-Fa-f]{6}$/.test(color) ? `#${color}` : undefined
}

/**
 * One game's play-by-play. The feed is newest first inside the quarter on
 * screen, so a live game and the end of a finished one open on the latest play.
 */
export function PlayByPlay({ game }: { game: GameBoxScore }) {
  const plays = game.plays ?? []
  const periods = [...new Set(plays.map(play => play.period).filter(period => period > 0))].sort((a, b) => a - b)
  const latest = periods[periods.length - 1] ?? 0
  const [chosenPeriod, setChosenPeriod] = useState<number | null>(null)
  const [filter, setFilter] = useState<PlayFilter>('all')
  const [open, setOpen] = useState(true)
  const period = chosenPeriod != null && periods.includes(chosenPeriod) ? chosenPeriod : latest
  const inPeriod = plays.filter(play => play.period === period)
  const shown = (filter === 'scoring' ? inPeriod.filter(play => play.scoring) : inPeriod).slice().reverse()
  const scoringCount = inPeriod.filter(play => play.scoring).length

  if (plays.length === 0) return null

  return (
    <section className="mt-5 border-t border-gray-100 pt-4 dark:border-gray-800">
      <button
        type="button"
        onClick={() => setOpen(current => !current)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
      >
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Play-by-play</span>
        <span className="text-[11px] text-gray-400">{periodName(period)} · newest first</span>
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
          className={`ml-auto h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
        <div className="mt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div role="tablist" aria-label="Quarter" className="flex gap-1 overflow-x-auto">
              {periods.map(item => {
                const selected = item === period
                return (
                  <button
                    key={item}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setChosenPeriod(item)}
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                      selected
                        ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                    }`}
                  >
                    {periodName(item)}
                  </button>
                )
              })}
            </div>
            <div role="group" aria-label="Which plays" className="inline-flex rounded-full bg-gray-100 p-0.5 dark:bg-gray-800">
              {([
                ['all', `All ${inPeriod.length}`],
                ['scoring', `Scoring ${scoringCount}`],
              ] as const).map(([id, label]) => {
                const selected = filter === id
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setFilter(id)}
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                      selected
                        ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-gray-100'
                        : 'text-gray-500 dark:text-gray-400'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          {shown.length === 0 ? (
            <p className="px-1 py-6 text-center text-xs text-gray-400">No baskets this quarter.</p>
          ) : (
            <div key={`${period}-${filter}`} className="mt-2 max-h-80 overflow-y-auto overscroll-contain rounded-lg border border-gray-100 dark:border-gray-800">
              <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-gray-100 bg-white/95 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 backdrop-blur dark:border-gray-800 dark:bg-gray-900/95">
                <span className="w-11 shrink-0 text-right">Time</span>
                <span className="min-w-0 flex-1">Play</span>
                <span className="w-8 shrink-0 text-center">{game.away.abbreviation}</span>
                <span className="w-8 shrink-0 text-center">{game.home.abbreviation}</span>
              </div>
              <ol>
                {shown.map(play => (
                  <PlayRow key={play.id} play={play} game={game} />
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function PlayRow({ play, game }: { play: BoxPlay; game: GameBoxScore }) {
  if (play.kind === 'period') {
    return (
      <li className="border-t border-gray-100 px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:border-gray-800">
        {play.text}
      </li>
    )
  }

  const team = play.team_id === game.away.team_id ? game.away : play.team_id === game.home.team_id ? game.home : null
  const awayScored = play.scoring && play.team_id === game.away.team_id
  const homeScored = play.scoring && play.team_id === game.home.team_id
  const quiet = play.kind === 'sub' || play.kind === 'timeout'
  const color = team ? teamColor(team.color) : undefined

  return (
    <li
      className={`flex items-start gap-2 border-t border-gray-100 px-2 py-1.5 dark:border-gray-800 ${
        play.scoring ? 'bg-emerald-50/80 dark:bg-emerald-950/30' : ''
      }`}
      style={color ? { boxShadow: `inset 3px 0 0 ${color}` } : undefined}
    >
      <span className="w-11 shrink-0 pt-0.5 text-right text-[11px] tabular-nums text-gray-400">{play.clock}</span>
      <p className={`min-w-0 flex-1 text-xs leading-snug ${quiet ? 'text-gray-400' : 'text-gray-800 dark:text-gray-100'}`}>
        {play.points > 0 && (
          <span className="mr-1.5 inline-block rounded bg-emerald-600 px-1 py-px text-[10px] font-bold tabular-nums text-white">
            +{play.points}
          </span>
        )}
        {play.text}
      </p>
      <span className={`w-8 shrink-0 pt-0.5 text-center text-xs tabular-nums ${awayScored ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-400'}`}>
        {play.away_score}
      </span>
      <span className={`w-8 shrink-0 pt-0.5 text-center text-xs tabular-nums ${homeScored ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-400'}`}>
        {play.home_score}
      </span>
    </li>
  )
}

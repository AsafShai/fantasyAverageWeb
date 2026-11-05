import { useMemo, useState, type ReactNode } from 'react'
import type { PlayerMatchup, RosterDay, RosterDayPlayer } from '../types/api'
import PlayerNameLink from './PlayerNameLink'
import InjuryBadge from './InjuryBadge'
import LoadingSpinner from './LoadingSpinner'
import { nameCellWrapClass, wrapFriendlyName } from '../utils/wrapName'
import { addDays } from '../utils/slateWindow'
import { dayLabel, isBench, lineupSlotOrder, moveNote, moveTime, pct, starterTotals } from '../utils/rosterDay'
import './MatchupDisplay.css'

/** The Slot cell's content: IR pill, active-slot pill, or plain BE. */
export function SlotPill({ slot, activeTitle = 'Active lineup slot' }: { slot?: string | null; activeTitle?: string }) {
  if (slot === 'IR') {
    return <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-600 ring-1 ring-inset ring-red-200" title="Injured reserve">IR</span>
  }
  if (slot && slot !== 'BE') {
    return <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-sky-400/15 dark:text-sky-300 dark:ring-sky-400/40" title={activeTitle}>{slot}</span>
  }
  return <>{slot ?? '—'}</>
}

// ---------------------------------------------------------------------------
// Stepper (sits where the period selector does in Stats mode)
// ---------------------------------------------------------------------------

export function RosterDayStepper({
  date,
  firstDate,
  lastDate,
  note,
  onChange,
}: {
  date: string
  firstDate?: string
  lastDate?: string
  note?: string
  onChange: (date: string) => void
}) {
  const atStart = !!firstDate && date <= firstDate
  const atToday = !!lastDate && date >= lastDate
  const stepButton = 'rounded-md px-2 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed'
  return (
    <div className="flex w-full flex-col gap-1.5 sm:w-auto sm:flex-row sm:items-center sm:justify-end sm:gap-2">
      {note && <span className="text-xs text-gray-500" data-testid="roster-day-note">{note}</span>}
      <div className="flex w-full items-center gap-1 rounded-lg bg-gray-100 p-1 sm:w-auto">
        <button type="button" aria-label="Previous day" className={stepButton} disabled={atStart} onClick={() => onChange(addDays(date, -1))}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <label className="relative flex-1 cursor-pointer rounded-md bg-white px-3 py-1.5 text-center text-xs font-medium whitespace-nowrap text-blue-600 shadow-sm sm:flex-none sm:min-w-[6.5rem]">
          {dayLabel(date)}
          <input
            type="date"
            aria-label="Pick a day"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            value={date}
            min={firstDate}
            max={lastDate}
            onChange={(e) => e.target.value && onChange(e.target.value)}
          />
        </label>
        <button type="button" aria-label="Next day" className={stepButton} disabled={atToday} onClick={() => onChange(addDays(date, 1))}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        </button>
        <button
          type="button"
          className="rounded-md px-3 py-1.5 text-center text-xs font-medium whitespace-nowrap text-gray-600 hover:text-gray-800 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={atToday}
          onClick={() => lastDate && onChange(lastDate)}
        >
          Today
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Moves strip + table
// ---------------------------------------------------------------------------

function MovesStrip({ day, highlight, onPick }: { day: RosterDay; highlight: number | null; onPick: (id: number) => void }) {
  const name = (player: { player_id: number; name: string; on_roster: boolean }, sign: string, tone: string) =>
    player.on_roster ? (
      <button
        key={`${sign}${player.player_id}`}
        type="button"
        className={`font-medium ${tone} hover:underline cursor-pointer ${highlight === player.player_id ? 'underline' : ''}`}
        title="Highlight in the table"
        onClick={() => onPick(player.player_id)}
      >
        {sign} {player.name}
      </button>
    ) : (
      <span key={`${sign}${player.player_id}`} className={`font-medium ${tone}`} title="Not on the roster at this day's lock">
        {sign} {player.name}
      </span>
    )
  return (
    // One line per move: time, who came in, who went out (and a note only for a
    // waiver claim, a trade, or a move made after the previous day's lock).
    <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2" data-testid="roster-day-moves">
      <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-6">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Moves</span>
        {day.moves.length === 0 && <span className="text-sm text-gray-500">No adds or drops this day</span>}
        {day.moves.map(move => {
          const note = moveNote(move, day.date)
          return (
            <span key={move.id} className="flex flex-wrap items-baseline gap-x-2 text-sm" data-testid="roster-day-move">
              <span className="text-xs tabular-nums text-gray-500">{moveTime(move, day.date)}</span>
              {move.added.map(p => name(p, '+', 'text-blue-700 dark:text-sky-300'))}
              {move.dropped.map(p => name(p, '−', 'text-red-600'))}
              {note && <span className="text-xs text-gray-500">{note}</span>}
            </span>
          )
        })}
      </div>
    </div>
  )
}

const TH = 'px-3 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider'
const COLUMNS: { label: string; align: 'left' | 'right' }[] = [
  { label: 'Slot', align: 'left' },
  { label: 'Player', align: 'left' },
  { label: 'Position', align: 'left' },
  { label: 'Pro Team', align: 'left' },
  { label: 'Opp', align: 'left' },
  { label: 'Min', align: 'right' },
  { label: 'FG%', align: 'right' },
  { label: 'FT%', align: 'right' },
  { label: '3PM', align: 'right' },
  { label: 'REB', align: 'right' },
  { label: 'AST', align: 'right' },
  { label: 'STL', align: 'right' },
  { label: 'BLK', align: 'right' },
  { label: 'PTS', align: 'right' },
]

function Shooting({ made, attempted, muted }: { made: number; attempted: number; muted: boolean }) {
  return (
    <>
      {pct(made, attempted)}
      <span className={`ml-1.5 text-xs ${muted ? 'text-gray-400' : 'text-gray-500'}`}>{made}/{attempted}</span>
    </>
  )
}

function statCells(player: RosterDayPlayer): ReactNode[] {
  const s = player.stats
  if (player.status === 'played' && s) {
    const muted = isBench(player.lineup_slot)
    return [
      s.minutes,
      <Shooting made={s.fgm} attempted={s.fga} muted={muted} />,
      <Shooting made={s.ftm} attempted={s.fta} muted={muted} />,
      s.three_pm, s.reb, s.ast, s.stl, s.blk, s.pts,
    ]
  }
  const first = player.status === 'dnp' ? 'DNP' : '—'
  return [first, '—', '—', '—', '—', '—', '—', '—', '—']
}

export function RosterDayContent({
  day,
  loading,
  matchups,
}: {
  day: RosterDay | undefined
  loading: boolean
  /** Today's matchups by player name, for the injury badge (today only). */
  matchups?: Map<string, PlayerMatchup>
}) {
  const [highlight, setHighlight] = useState<number | null>(null)
  const [highlightDate, setHighlightDate] = useState<string | null>(null)
  const activeHighlight = day && highlightDate === day.date ? highlight : null
  const players = useMemo(
    () => (day ? [...day.players].sort((a, b) => lineupSlotOrder(a.lineup_slot) - lineupSlotOrder(b.lineup_slot)) : []),
    [day],
  )
  const totals = useMemo(() => starterTotals(players), [players])

  if (loading || !day) return <LoadingSpinner />

  const pick = (id: number) => {
    setHighlightDate(day.date)
    setHighlight(prev => (prev === id && highlightDate === day.date ? null : id))
  }

  return (
    <>
      <MovesStrip day={day} highlight={activeHighlight} onPick={pick} />
      {players.length === 0 ? (
        <div className="py-12 text-center text-gray-400 text-sm">No roster for this day.</div>
      ) : (
        <div className="overflow-auto max-h-[70vh] mq-scroll-container">
          <table className="min-w-full border-separate border-spacing-0 [&_th]:border-b [&_td]:border-b [&_th]:border-gray-200 [&_td]:border-gray-200" data-testid="roster-day-table">
            <thead className="sticky top-0 z-20 bg-gray-50">
              <tr>
                {COLUMNS.map(column => (
                  <th
                    key={column.label}
                    className={`${TH} text-${column.align} ${column.label === 'Player' ? 'sticky left-0 z-10 bg-gray-50 border-r border-r-gray-200' : ''}`}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white">
              {players.map(player => {
                const bench = isBench(player.lineup_slot)
                const lit = activeHighlight === player.player_id
                const tone = player.status === 'played' && !bench ? 'text-gray-900' : 'text-gray-400'
                const matchup = day.is_today ? matchups?.get(player.player_name) : undefined
                return (
                  <tr key={player.player_id} className={lit ? 'bg-blue-50' : 'hover:bg-gray-50'} data-testid="roster-day-row">
                    <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-400">
                      <SlotPill slot={player.lineup_slot} activeTitle="Lineup slot at lock" />
                    </td>
                    {/* Same columns and name rule as the Stats table (utils/wrapName): a name of
                        16 characters or fewer stays on one line; a longer one wraps between
                        words within 38vw on phones. */}
                    <td className={`px-3 py-3 ${nameCellWrapClass(player.player_name)} text-sm font-medium text-gray-900 sticky left-0 z-10 border-r border-r-gray-200 ${lit ? 'bg-blue-50' : 'bg-white'}`}>
                      <PlayerNameLink name={wrapFriendlyName(player.player_name)} playerId={player.player_id} />{' '}
                      <InjuryBadge status={matchup?.injury_status} />
                      {(player.added || player.dropped) && (
                        // One compact two-part tag (Added | Dropped). Under the name on phones,
                        // where beside a one-line name it would widen the sticky column; beside it
                        // from sm up. Tinted with /10 and /15 alphas (as the slot pill is), not
                        // bg-*-50, which dark mode flattens.
                        <span className="mt-1 flex w-fit overflow-hidden rounded text-xs font-medium whitespace-nowrap ring-1 ring-inset ring-gray-200 sm:mt-0 sm:ml-1.5 sm:inline-flex sm:align-middle dark:ring-gray-600">
                          {player.added && (
                            <span className="bg-blue-500/10 px-1.5 py-0.5 text-blue-700 dark:bg-sky-400/15 dark:text-sky-300" title="First day on this roster">Added</span>
                          )}
                          {player.dropped && (
                            <span className={`bg-red-500/10 px-1.5 py-0.5 text-red-700 dark:bg-red-400/15 ${player.added ? 'border-l border-gray-200 dark:border-gray-600' : ''}`} title="Last day on this roster">Dropped</span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-500">{player.positions.join(', ')}</td>
                    <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-500">{player.pro_team}</td>
                    <td className={`px-3 py-3 whitespace-nowrap text-sm ${bench ? 'text-gray-400' : 'text-gray-900'}`}>
                      {player.opponent ? <span className="mq-opp">vs {player.opponent}</span> : <span className="mq-no-game">—</span>}
                    </td>
                    {statCells(player).map((value, i) => (
                      <td key={i} className={`px-3 py-3 whitespace-nowrap text-sm text-right ${tone}`}>{value}</td>
                    ))}
                  </tr>
                )
              })}
              <tr className="bg-gradient-to-r from-blue-50 to-indigo-50 font-bold [&_td]:border-t-2 [&_td]:border-t-blue-400 [&_td]:border-b-0" data-testid="roster-day-totals">
                <td className="px-3 py-3 whitespace-nowrap text-sm text-blue-700">-</td>
                <td className="px-3 py-3 whitespace-nowrap text-sm font-bold text-blue-900 sticky left-0 z-10 bg-gradient-to-r from-blue-50 to-indigo-50 border-r border-r-gray-200">
                  {/* The date is in the stepper above; on phones it would widen the sticky column. */}
                  Starters<span className="hidden sm:inline"> ({day.is_today ? 'Today' : dayLabel(day.date)})</span>
                </td>
                <td className="px-3 py-3 whitespace-nowrap text-sm text-blue-700">{totals.games} {totals.games === 1 ? 'game' : 'games'}</td>
                <td className="px-3 py-3 whitespace-nowrap text-sm text-blue-700">-</td>
                <td className="px-3 py-3 whitespace-nowrap text-sm text-blue-700">-</td>
                {(totals.games
                  ? [
                      totals.minutes,
                      <>{pct(totals.fgm, totals.fga)}<span className="ml-1.5 text-xs font-normal text-blue-700">{totals.fgm}/{totals.fga}</span></>,
                      <>{pct(totals.ftm, totals.fta)}<span className="ml-1.5 text-xs font-normal text-blue-700">{totals.ftm}/{totals.fta}</span></>,
                      totals.three_pm, totals.reb, totals.ast, totals.stl, totals.blk, totals.pts,
                    ]
                  : Array(9).fill('—')
                ).map((value, i) => (
                  <td key={i} className="px-3 py-3 whitespace-nowrap text-sm text-right text-blue-900">{value}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

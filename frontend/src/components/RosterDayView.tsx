import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { Chip, ChipRow } from '../mobile/ui'
import type { PlayerMatchup, PlayerStats, RosterDay, RosterDayGame, RosterDayPlayer, RosterDayStats } from '../types/api'
import PlayerNameLink from './PlayerNameLink'
import InjuryBadge from './InjuryBadge'
import LoadingSpinner from './LoadingSpinner'
import { MatchupCell, MatchupExpandPanel, MatchupExpandRow } from './MatchupDisplay'
import { nameCellWrapClass, wrapFriendlyName } from '../utils/wrapName'
import { addDays } from '../utils/slateWindow'
import { dayLabel, gameLabel, startersDayLabel, isBench, lineupSlotOrder, liveRosterMoment, moveNote, moveTime, pct, rosterDayPlayerPlayed, starterTotals, type StarterTotals } from '../utils/rosterDay'
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

/**
 * The player's game on his roster line: the result once it is over, the score
 * and clock while it is on, the tip time before. Hidden scores in no-spoilers mode.
 */
export function GameTag({ game, noSpoilers = false, className = '' }: { game?: RosterDayGame | null; noSpoilers?: boolean; className?: string }) {
  // No spoilers: the line shows the opponent only, as before.
  if (!game || noSpoilers) return null
  const label = gameLabel(game)
  if (!label) return null
  if (game.status === 'live') {
    return (
      <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-bold text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200 ${className}`} data-testid="roster-game-tag">
        LIVE <span className="font-semibold tabular-nums">{label}</span>
      </span>
    )
  }
  const tone = game.status === 'final' ? 'font-semibold text-gray-700 dark:text-gray-200' : 'text-gray-500 dark:text-gray-400'
  return <span className={`whitespace-nowrap text-xs tabular-nums ${tone} ${className}`} data-testid="roster-game-tag">{label}</span>
}

const hasLine = (player: RosterDayPlayer) => (player.status === 'played' || player.status === 'live') && !!player.stats

// ---------------------------------------------------------------------------
// Stepper (sits where the period selector does in Stats mode)
// ---------------------------------------------------------------------------

export function RosterDayStepper({
  date,
  firstDate,
  lastDate,
  note,
  onChange,
  compact = false,
}: {
  date: string
  firstDate?: string
  lastDate?: string
  note?: string
  onChange: (date: string) => void
  /** Denser layout for mobile sticky toolbars. */
  compact?: boolean
}) {
  const atStart = !!firstDate && date <= firstDate
  const atToday = !!lastDate && date >= lastDate
  const stepButton = compact
    ? 'rounded-md px-1.5 py-1 text-[11px] font-medium text-gray-600 hover:text-gray-800 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed dark:text-gray-400 dark:hover:text-gray-200'
    : 'rounded-md px-2 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed'
  return (
    <div
      className={
        compact
          ? 'flex w-full flex-row flex-wrap items-center gap-x-2 gap-y-1'
          : 'flex w-full flex-col gap-1.5 sm:w-auto sm:flex-row sm:items-center sm:justify-end sm:gap-2'
      }
    >
      {note && (
        <span
          className={compact ? 'w-full truncate text-[10px] leading-tight text-gray-500 dark:text-gray-400' : 'text-xs text-gray-500'}
          data-testid="roster-day-note"
        >
          {note}
        </span>
      )}
      <div className={`flex w-full flex-1 items-center gap-0.5 rounded-lg bg-gray-100 p-0.5 sm:w-auto dark:bg-gray-700/50 ${compact ? 'min-w-0' : ''}`}>
        <button type="button" aria-label="Previous day" className={stepButton} disabled={atStart} onClick={() => onChange(addDays(date, -1))}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <label className={`relative flex-1 cursor-pointer rounded-md bg-white text-center font-medium whitespace-nowrap text-blue-600 shadow-sm dark:bg-gray-800 dark:text-blue-400 sm:flex-none ${compact ? 'min-w-0 px-2 py-1 text-[11px] sm:min-w-[5.5rem]' : 'px-3 py-1.5 text-xs sm:min-w-[6.5rem]'}`}>
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
          className={
            compact
              ? 'rounded-md px-2 py-1 text-center text-[11px] font-medium whitespace-nowrap text-gray-600 transition-all duration-200 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-400 dark:hover:text-gray-200'
              : 'rounded-md px-3 py-1.5 text-center text-xs font-medium whitespace-nowrap text-gray-600 transition-all duration-200 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-40'
          }
          disabled={atToday}
          onClick={() => lastDate && onChange(lastDate)}
        >
          Today
        </button>
      </div>
    </div>
  )
}

function rosterFilterBtnClass(active: boolean) {
  return [
    'flex-1 whitespace-nowrap text-center font-medium transition-all duration-200 sm:flex-none sm:min-w-[5.5rem] px-3 py-1.5 text-xs',
    active
      ? 'bg-blue-600 text-white dark:bg-blue-500'
      : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700',
  ].join(' ')
}

/** Past days only — All vs Played only (same pill pattern as Per Game / Totals). */
export function RosterDayOnlyPlayedToggle({
  checked,
  onChange,
  compact = false,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  compact?: boolean
}) {
  if (compact) {
    return (
      <ChipRow label="Roster rows" wrap className="mr-tm-roster-filter">
        <Chip selected={!checked} onClick={() => onChange(false)}>
          All players
        </Chip>
        <Chip selected={checked} onClick={() => onChange(true)}>
          Played only
        </Chip>
      </ChipRow>
    )
  }

  return (
    <div
      role="group"
      aria-label="Roster rows"
      data-testid="roster-day-only-played"
      className="flex w-full min-w-0 overflow-hidden rounded border border-gray-300 sm:w-auto dark:border-gray-600"
    >
      <button
        type="button"
        aria-pressed={!checked}
        className={`${rosterFilterBtnClass(!checked)} border-r border-gray-300 dark:border-gray-600`}
        onClick={() => onChange(false)}
      >
        All players
      </button>
      <button
        type="button"
        aria-pressed={checked}
        className={rosterFilterBtnClass(checked)}
        onClick={() => onChange(true)}
      >
        Played only
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Moves strip + table
// ---------------------------------------------------------------------------

export function MovesStrip({ day, highlight, onPick }: { day: RosterDay; highlight: number | null; onPick: (id: number) => void }) {
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
const INFO_COLUMNS: { label: string; align: 'left' | 'right'; key: string }[] = [
  { label: 'Position', align: 'left', key: 'pos' },
  { label: 'Pro Team', align: 'left', key: 'team' },
  { label: 'Opp', align: 'left', key: 'opp' },
]
const STAT_HEADER_COLUMNS: { label: string; align: 'right' }[] = [
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

const NO_GAME_TODAY = 'No game today'

function oppLabel(isToday: boolean, player: RosterDayPlayer): string {
  if (player.opponent) return `vs ${player.opponent}`
  return isToday ? NO_GAME_TODAY : '—'
}

function statCells(player: RosterDayPlayer): ReactNode[] {
  const s = player.stats
  if (hasLine(player) && s) {
    const muted = isBench(player.lineup_slot)
    return [
      s.minutes,
      <Shooting made={s.fgm} attempted={s.fga} muted={muted} />,
      <Shooting made={s.ftm} attempted={s.fta} muted={muted} />,
      s.three_pm, s.reb, s.ast, s.stl, s.blk, s.pts,
    ]
  }
  // Today's "No game today" is already in the Opp column.
  const first = player.status === 'dnp' ? 'DNP' : '—'
  return [first, '—', '—', '—', '—', '—', '—', '—', '—']
}

function Shooting({
  made,
  attempted,
  muted,
}: { made: number; attempted: number; muted: boolean }) {
  return (
    <>
      {pct(made, attempted)}
      <span className={`ml-1.5 text-xs ${muted ? 'text-gray-400' : 'text-gray-500'}`}>
        {made}/{attempted}
      </span>
    </>
  )
}

/** Map single-game line to PlayerStats shape so MatchupCell can weight Best Cat vs season benchmarks. */
function rosterDayStatsToPlayerStats(s: RosterDayStats | null | undefined): PlayerStats | undefined {
  if (!s) return undefined
  const gp = 1
  return {
    minutes: s.minutes,
    fgm: s.fgm,
    fga: s.fga,
    ftm: s.ftm,
    fta: s.fta,
    fg_percentage: s.fga > 0 ? s.fgm / s.fga : 0,
    ft_percentage: s.fta > 0 ? s.ftm / s.fta : 0,
    three_pm: s.three_pm,
    reb: s.reb,
    ast: s.ast,
    stl: s.stl,
    blk: s.blk,
    pts: s.pts,
    gp,
  }
}

function RosterDayDesktopStartersTotalsRow({
  day,
  totals,
  showStatColumns,
}: {
  day: RosterDay
  totals: StarterTotals
  showStatColumns: boolean
}) {
  return (
    <tr
      className="bg-gradient-to-r from-blue-50 to-indigo-50 font-bold dark:from-blue-950/40 dark:to-indigo-950/40 [&_td]:border-t-2 [&_td]:border-t-blue-400 [&_td]:border-b-0"
      data-testid="roster-day-totals"
    >
      <td className="px-3 py-3 whitespace-nowrap text-sm text-blue-700 dark:text-blue-300">-</td>
      <td className="sticky left-0 z-10 border-r border-r-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50 px-3 py-3 text-sm font-bold whitespace-nowrap text-blue-900 dark:border-gray-700 dark:from-blue-950/50 dark:to-indigo-950/50 dark:text-blue-100">
        Starters<span className="hidden sm:inline"> ({startersDayLabel(day)})</span>
      </td>
      <td className="px-3 py-3 whitespace-nowrap text-sm text-blue-700 dark:text-blue-300">
        {totals.games} {totals.games === 1 ? 'game' : 'games'}
      </td>
      <td className="px-3 py-3 whitespace-nowrap text-sm text-blue-700 dark:text-blue-300">-</td>
      <td className="px-3 py-3 whitespace-nowrap text-sm text-blue-700 dark:text-blue-300">-</td>
      {/* Today's table has Status and Matchup columns too. */}
      {day.is_today && [0, 1].map(i => (
        <td key={`today-${i}`} className="px-3 py-3 whitespace-nowrap text-sm text-blue-700 dark:text-blue-300">-</td>
      ))}
      {showStatColumns &&
        (totals.games
          ? [
              totals.minutes,
              <>{pct(totals.fgm, totals.fga)}<span className="ml-1.5 text-xs font-normal text-blue-700 dark:text-blue-300">{totals.fgm}/{totals.fga}</span></>,
              <>{pct(totals.ftm, totals.fta)}<span className="ml-1.5 text-xs font-normal text-blue-700 dark:text-blue-300">{totals.ftm}/{totals.fta}</span></>,
              totals.three_pm,
              totals.reb,
              totals.ast,
              totals.stl,
              totals.blk,
              totals.pts,
            ]
          : Array(9).fill('—')
        ).map((value, i) => (
          <td key={i} className="px-3 py-3 whitespace-nowrap text-sm text-right text-blue-900 dark:text-blue-100">
            {value}
          </td>
        ))}
    </tr>
  )
}

function RosterDayMobileStartersTotals({ day, totals }: { day: RosterDay; totals: StarterTotals }) {
  const hasGames = totals.games > 0
  const label = 'block text-[8px] uppercase text-blue-800/80 dark:text-blue-300/90'
  const val = 'font-bold tabular-nums text-blue-950 dark:text-blue-100'
  const sub = 'block text-[9px] tabular-nums text-blue-800/70 dark:text-blue-300/80'
  return (
    <div
      className="rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-3 dark:border-blue-900/60 dark:from-blue-950/40 dark:to-indigo-950/40"
      data-testid="roster-day-mobile-totals"
    >
      <p className="text-[11px] font-bold text-blue-900 dark:text-blue-100">
        Starters ({startersDayLabel(day)}) · {totals.games} {totals.games === 1 ? 'game' : 'games'}
      </p>
      {hasGames ? (
        <>
          <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] tabular-nums">
            <div>
              <span className={label}>MIN</span>
              <span className={val}>{totals.minutes}</span>
            </div>
            <div>
              <span className={label}>FG%</span>
              <span className={val}>{pct(totals.fgm, totals.fga)}</span>
              <span className={sub}>
                {totals.fgm}/{totals.fga}
              </span>
            </div>
            <div>
              <span className={label}>FT%</span>
              <span className={val}>{pct(totals.ftm, totals.fta)}</span>
              <span className={sub}>
                {totals.ftm}/{totals.fta}
              </span>
            </div>
            <div>
              <span className={label}>3PM</span>
              <span className={val}>{totals.three_pm}</span>
            </div>
            <div>
              <span className={label}>REB</span>
              <span className={val}>{totals.reb}</span>
            </div>
            <div>
              <span className={label}>AST</span>
              <span className={val}>{totals.ast}</span>
            </div>
            <div>
              <span className={label}>STL</span>
              <span className={val}>{totals.stl}</span>
            </div>
            <div>
              <span className={label}>BLK</span>
              <span className={val}>{totals.blk}</span>
            </div>
            <div>
              <span className={label}>PTS</span>
              <span className={val}>{totals.pts}</span>
            </div>
          </div>
        </>
      ) : (
        <p className="mt-1 text-[11px] text-blue-800/80 dark:text-blue-300/80">No starter minutes this day</p>
      )}
    </div>
  )
}

function RosterDayMobilePlayerCard({
  player,
  day,
  matchup,
  lit,
  isExpanded,
  onToggleMatchup,
  showStatDetails = true,
  noSpoilers = false,
}: {
  player: RosterDayPlayer
  day: RosterDay
  matchup: PlayerMatchup | undefined
  lit: boolean
  isExpanded: boolean
  onToggleMatchup: () => void
  /** When false (e.g. today's slate), hide the per-player stat grid on mobile. */
  showStatDetails?: boolean
  noSpoilers?: boolean
}) {
  const bench = isBench(player.lineup_slot)
  const s = player.stats
  const opp = oppLabel(day.is_today, player)
  const metaLine = [player.positions.join(', '), player.pro_team, opp].join(' · ')
  /** Past days: full stat grid. Today with stats hidden: only DNP needs a short line. */
  const showMobileStatsBlock = showStatDetails
    ? !day.is_today || player.status === 'dnp' || hasLine(player)
    : day.is_today && player.status === 'dnp'

  return (
    <div
      className={`w-full rounded-xl border p-3 text-left transition-colors ${
        lit
          ? 'border-blue-400 bg-blue-50/90 dark:border-blue-500 dark:bg-blue-950/30'
          : 'border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-800/80'
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="shrink-0 pt-0.5">
          <SlotPill slot={player.lineup_slot} activeTitle="Lineup slot at lock" />
        </div>
        <div className="min-w-0 flex-1">
          <div className={`font-medium leading-snug text-gray-900 dark:text-gray-100 ${nameCellWrapClass(player.player_name)}`}>
            <PlayerNameLink name={wrapFriendlyName(player.player_name)} playerId={player.player_id} />
          </div>
          {(player.added || player.dropped) && (
            <span className="mt-1 inline-flex overflow-hidden rounded text-[10px] font-semibold ring-1 ring-inset ring-gray-200 dark:ring-gray-600">
              {player.added && (
                <span className="bg-blue-500/10 px-1.5 py-0.5 text-blue-700 dark:bg-sky-400/15 dark:text-sky-300">Added</span>
              )}
              {player.dropped && (
                <span className={`bg-red-500/10 px-1.5 py-0.5 text-red-700 dark:bg-red-400/15 ${player.added ? 'border-l border-gray-200 dark:border-gray-600' : ''}`}>
                  Dropped
                </span>
              )}
            </span>
          )}
          <p className="mt-1 min-w-0 break-words text-[11px] leading-snug text-gray-500 dark:text-gray-400">
            {metaLine}
            {player.game && <GameTag game={player.game} noSpoilers={noSpoilers} className="ml-1.5" />}
          </p>
          {day.is_today && matchup?.injury_status && (
            <div className="mt-1">
              <InjuryBadge status={matchup.injury_status} />
            </div>
          )}
          {day.is_today && (
            <div className="mt-2">
              <MatchupCell
                matchup={matchup}
                isExpanded={isExpanded}
                onToggle={onToggleMatchup}
                playerStats={rosterDayStatsToPlayerStats(player.stats)}
              />
            </div>
          )}
          {showMobileStatsBlock && (
            <div className="mt-2 border-t border-gray-100 pt-2 dark:border-gray-700">
              {hasLine(player) && s ? (
                <>
                  <div className="grid grid-cols-3 gap-2 text-[10px] tabular-nums">
                    <div>
                      <span className="block text-[8px] uppercase text-gray-400">MIN</span>
                      <span className={`font-semibold ${bench ? 'text-gray-400' : 'text-gray-900 dark:text-gray-100'}`}>{s.minutes}</span>
                    </div>
                    <div>
                      <span className="block text-[8px] uppercase text-gray-400">FG%</span>
                      <span className={`font-semibold ${bench ? 'text-gray-400' : 'text-gray-900 dark:text-gray-100'}`}>{pct(s.fgm, s.fga)}</span>
                      <span className={`block text-[9px] ${bench ? 'text-gray-400' : 'text-gray-500 dark:text-gray-400'}`}>
                        {s.fgm}/{s.fga}
                      </span>
                    </div>
                    <div>
                      <span className="block text-[8px] uppercase text-gray-400">FT%</span>
                      <span className={`font-semibold ${bench ? 'text-gray-400' : 'text-gray-900 dark:text-gray-100'}`}>{pct(s.ftm, s.fta)}</span>
                      <span className={`block text-[9px] ${bench ? 'text-gray-400' : 'text-gray-500 dark:text-gray-400'}`}>
                        {s.ftm}/{s.fta}
                      </span>
                    </div>
                    <div>
                      <span className="block text-[8px] uppercase text-gray-400">3PM</span>
                      <span className={`font-semibold ${bench ? 'text-gray-400' : 'text-gray-900 dark:text-gray-100'}`}>{s.three_pm}</span>
                    </div>
                    <div>
                      <span className="block text-[8px] uppercase text-gray-400">REB</span>
                      <span className={`font-semibold ${bench ? 'text-gray-400' : 'text-gray-900 dark:text-gray-100'}`}>{s.reb}</span>
                    </div>
                    <div>
                      <span className="block text-[8px] uppercase text-gray-400">AST</span>
                      <span className={`font-semibold ${bench ? 'text-gray-400' : 'text-gray-900 dark:text-gray-100'}`}>{s.ast}</span>
                    </div>
                    <div>
                      <span className="block text-[8px] uppercase text-gray-400">STL</span>
                      <span className={`font-semibold ${bench ? 'text-gray-400' : 'text-gray-900 dark:text-gray-100'}`}>{s.stl}</span>
                    </div>
                    <div>
                      <span className="block text-[8px] uppercase text-gray-400">BLK</span>
                      <span className={`font-semibold ${bench ? 'text-gray-400' : 'text-gray-900 dark:text-gray-100'}`}>{s.blk}</span>
                    </div>
                    <div>
                      <span className="block text-[8px] uppercase text-gray-400">PTS</span>
                      <span className={`font-semibold ${bench ? 'text-gray-400' : 'text-gray-900 dark:text-gray-100'}`}>{s.pts}</span>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-[11px] text-gray-400">
                  {player.status === 'dnp' ? 'Did not play' : day.is_today && !player.opponent ? NO_GAME_TODAY : '—'}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
      {day.is_today && isExpanded && matchup && (
        <div className="mq-card-expand-bleed -mx-3 mt-2 w-[calc(100%+1.5rem)] border-t border-gray-200 pt-2 dark:border-gray-600">
          <MatchupExpandPanel matchup={matchup} integerProjectionToggle layout="card" />
        </div>
      )}
    </div>
  )
}

export function RosterDayContent({
  day,
  loading,
  matchups,
  onlyPlayed = false,
  noSpoilers = false,
}: {
  day: RosterDay | undefined
  loading: boolean
  /** Today's matchups by player name, for the injury badge (today only). */
  matchups?: Map<string, PlayerMatchup>
  /** Past days: hide players who did not play (status !== played). */
  onlyPlayed?: boolean
  /** Box Scores' No spoilers: no results, scores or live lines; today shows opponents only. */
  noSpoilers?: boolean
}) {
  const [highlight, setHighlight] = useState<number | null>(null)
  const [highlightDate, setHighlightDate] = useState<string | null>(null)
  const [expandedMatchupNames, setExpandedMatchupNames] = useState<Set<string>>(new Set())
  const activeHighlight = day && highlightDate === day.date ? highlight : null
  const players = useMemo(() => {
    if (!day) return []
    const sorted = [...day.players].sort((a, b) => lineupSlotOrder(a.lineup_slot) - lineupSlotOrder(b.lineup_slot))
    if (!onlyPlayed || day.is_today) return sorted
    return sorted.filter(rosterDayPlayerPlayed)
  }, [day, onlyPlayed])
  const totals = useMemo(() => starterTotals(players), [players])
  /** Hide Min/FG%/… columns on today’s daily roster until games are counted live; show them for past days. */
  const showStatColumns = day ? !day.is_today || liveRosterMoment(day, noSpoilers) !== null : false
  const mobileGroups = useMemo(() => {
    const starters = players.filter(p => !isBench(p.lineup_slot))
    const bench = players.filter(p => isBench(p.lineup_slot))
    return { starters, bench }
  }, [players])

  if (loading || !day) return <LoadingSpinner />

  const pick = (id: number) => {
    setHighlightDate(day.date)
    setHighlight(prev => (prev === id && highlightDate === day.date ? null : id))
  }

  const toggleMatchupExpand = (name: string) => {
    setExpandedMatchupNames(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const desktopColSpan =
    2 +
    (day.is_today ? 2 : 0) +
    INFO_COLUMNS.length +
    (showStatColumns ? STAT_HEADER_COLUMNS.length : 0)

  const renderDesktopPlayerRow = (player: (typeof players)[number]) => {
    const bench = isBench(player.lineup_slot)
    const lit = activeHighlight === player.player_id
    const tone = hasLine(player) && !bench ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'
    const onCourt = !noSpoilers && player.status === 'live' && !bench && (player.stats?.minutes ?? 0) > 0
    const matchup = day.is_today ? matchups?.get(player.player_name) : undefined
    const isExpanded = expandedMatchupNames.has(player.player_name)
    const stickyBg = lit ? 'bg-blue-50 dark:bg-blue-950/30' : onCourt ? 'bg-emerald-50 dark:bg-emerald-950/30' : 'bg-white dark:bg-gray-800'
    const cells = showStatColumns ? statCells(player) : []
    return (
      <Fragment key={player.player_id}>
        <tr className={lit ? 'bg-blue-50 dark:bg-blue-950/20' : onCourt ? 'bg-emerald-50 dark:bg-emerald-950/20' : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'} data-testid="roster-day-row" data-on-court={onCourt || undefined}>
          <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-400 dark:text-gray-500">
            <SlotPill slot={player.lineup_slot} activeTitle="Lineup slot at lock" />
          </td>
          <td className={`px-3 py-3 ${nameCellWrapClass(player.player_name)} text-sm font-medium text-gray-900 sticky left-0 z-10 border-r border-r-gray-200 dark:border-gray-700 ${stickyBg}`}>
            <PlayerNameLink name={wrapFriendlyName(player.player_name)} playerId={player.player_id} />
            {(player.added || player.dropped) && (
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
          {day.is_today && (
            <td className="px-3 py-3 whitespace-nowrap align-top text-sm">
              <InjuryBadge status={matchup?.injury_status} />
            </td>
          )}
          {day.is_today && (
            <td className="px-3 py-3 whitespace-nowrap align-top text-sm">
              <MatchupCell
                matchup={matchup}
                isExpanded={isExpanded}
                onToggle={() => toggleMatchupExpand(player.player_name)}
                playerStats={rosterDayStatsToPlayerStats(player.stats)}
              />
            </td>
          )}
          <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{player.positions.join(', ')}</td>
          <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{player.pro_team}</td>
          <td className={`px-3 py-3 whitespace-nowrap text-sm ${bench ? 'text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-gray-100'}`}>
            {player.opponent ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="mq-opp">vs {player.opponent}</span>
                <GameTag game={player.game} noSpoilers={noSpoilers} />
              </span>
            ) : day.is_today ? (
              <span className="mq-no-game text-gray-500 dark:text-gray-400">{NO_GAME_TODAY}</span>
            ) : (
              <span className="mq-no-game">—</span>
            )}
          </td>
          {cells.map((value, i) => (
            <td key={i} className={`px-3 py-3 whitespace-nowrap text-sm text-right ${tone}`}>{value}</td>
          ))}
        </tr>
        {day.is_today && isExpanded && matchup && (
          <MatchupExpandRow
            matchup={matchup}
            colSpan={desktopColSpan}
            integerProjectionToggle
          />
        )}
      </Fragment>
    )
  }

  return (
    <>
      <MovesStrip day={day} highlight={activeHighlight} onPick={pick} />
      {players.length === 0 ? (
        <div className="py-12 text-center text-gray-400 text-sm">
          {onlyPlayed && day && !day.is_today && day.players.length > 0
            ? 'No players logged a game this day.'
            : 'No roster for this day.'}
        </div>
      ) : (
        <>
        <div className="space-y-4 sm:hidden">
          {mobileGroups.starters.length > 0 && (
            <div>
              <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Lineup</h3>
              <ul className="space-y-2">
                {mobileGroups.starters.map(player => {
                  const lit = activeHighlight === player.player_id
                  const matchup = day.is_today ? matchups?.get(player.player_name) : undefined
                  const isExpanded = expandedMatchupNames.has(player.player_name)
                  return (
                    <li key={player.player_id}>
                      <RosterDayMobilePlayerCard
                        player={player}
                        day={day}
                        matchup={matchup}
                        lit={lit}
                        isExpanded={isExpanded}
                        onToggleMatchup={() => toggleMatchupExpand(player.player_name)}
                        showStatDetails={showStatColumns}
                        noSpoilers={noSpoilers}
                      />
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
          {showStatColumns && <RosterDayMobileStartersTotals day={day} totals={totals} />}
          {mobileGroups.bench.length > 0 && (
            <div>
              <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Bench · IR</h3>
              <ul className="space-y-2">
                {mobileGroups.bench.map(player => {
                  const lit = activeHighlight === player.player_id
                  const matchup = day.is_today ? matchups?.get(player.player_name) : undefined
                  const isExpanded = expandedMatchupNames.has(player.player_name)
                  return (
                    <li key={player.player_id}>
                      <RosterDayMobilePlayerCard
                        player={player}
                        day={day}
                        matchup={matchup}
                        lit={lit}
                        isExpanded={isExpanded}
                        onToggleMatchup={() => toggleMatchupExpand(player.player_name)}
                        showStatDetails={showStatColumns}
                        noSpoilers={noSpoilers}
                      />
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
        <div className="hidden overflow-auto max-h-[70vh] sm:block mq-scroll-container">
          <table className="min-w-full border-separate border-spacing-0 [&_th]:border-b [&_td]:border-b [&_th]:border-gray-200 [&_td]:border-gray-200" data-testid="roster-day-table">
            <thead className="sticky top-0 z-20 bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className={`${TH} text-left`}>Slot</th>
                <th className={`${TH} sticky left-0 z-10 border-r border-r-gray-200 bg-gray-50 text-left dark:border-gray-700 dark:bg-gray-900`}>
                  Player
                </th>
                {day.is_today && (
                  <th className={`${TH} text-left`}>Status</th>
                )}
                {day.is_today && (
                  <th className={`${TH} text-left`}>Matchup</th>
                )}
                {INFO_COLUMNS.map(column => (
                  <th key={column.key} className={`${TH} text-${column.align}`}>
                    {column.label}
                  </th>
                ))}
                {showStatColumns &&
                  STAT_HEADER_COLUMNS.map(column => (
                    <th key={column.label} className={`${TH} text-${column.align}`}>
                      {column.label}
                    </th>
                  ))}
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800">
              {mobileGroups.starters.map(renderDesktopPlayerRow)}
              {showStatColumns && (
                <RosterDayDesktopStartersTotalsRow day={day} totals={totals} showStatColumns={showStatColumns} />
              )}
              {mobileGroups.bench.map(renderDesktopPlayerRow)}
            </tbody>
          </table>
        </div>
        </>
      )}
    </>
  )
}

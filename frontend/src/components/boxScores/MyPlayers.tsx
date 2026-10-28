import { useState, type ReactNode } from 'react'
import PlayerNameLink from '../PlayerNameLink'
import { useGetGameBoxScoreQuery } from '../../store/api/fantasyApi'
import { BOX_LINE_COLUMNS, PlayerStatus } from './BoxScorePanel'
import { fouledOut } from './lineupGroups'
import { clusterByGame, myLine, type MyAppearance, type MyGroups } from './myPlayerGroups'
import { gameClockLabel } from './tipTime'
import type { BoxPlayerLine, BoxScoreGame } from '../../types/boxScore'

function summary(groups: MyGroups): string {
  const parts = [
    groups.live.length > 0 ? `${groups.live.length} playing` : '',
    groups.upcoming.length > 0 ? `${groups.upcoming.length} yet to play` : '',
    groups.done.length > 0 ? `${groups.done.length} finished` : '',
  ].filter(Boolean)
  return parts.join(' · ')
}

function matchup(game: BoxScoreGame): string {
  return `${game.away.abbreviation} @ ${game.home.abbreviation}`
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
    </svg>
  )
}

function marginClass(value: string): string {
  if (value.startsWith('+') && value !== '+0') return 'text-emerald-600 dark:text-emerald-400'
  if (value.startsWith('-')) return 'text-rose-600 dark:text-rose-400'
  return 'text-gray-800 dark:text-gray-100'
}

function StatLabels({ hideOnWide = false }: { hideOnWide?: boolean }) {
  return (
    <tr className={`text-[10px] uppercase tracking-wide text-gray-400 ${hideOnWide ? 'lg:hidden' : ''}`}>
      {BOX_LINE_COLUMNS.map(column => (
        <th key={column.key} className="px-1 py-0.5 text-right font-medium">{column.label}</th>
      ))}
    </tr>
  )
}

function StatStrip({ line, hideLabelsOnWide = false }: { line: BoxPlayerLine; hideLabelsOnWide?: boolean }) {
  return (
    <div className="w-full overflow-x-auto lg:overflow-visible">
      <table className="w-full min-w-[34rem] table-fixed text-[11px] lg:min-w-full">
        <caption className="sr-only">{line.name} line</caption>
        <thead>
          <StatLabels hideOnWide={hideLabelsOnWide} />
        </thead>
        <tbody>
          <tr className="tabular-nums">
            {BOX_LINE_COLUMNS.map(column => {
              const out = column.key === 'pf' && fouledOut(line.pf)
              const tone = column.key === 'plus_minus'
                ? marginClass(line[column.key])
                : out
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-gray-800 dark:text-gray-100'
              return (
                <td
                  key={column.key}
                  title={out ? 'Fouled out' : undefined}
                  className={`whitespace-nowrap px-1 py-0.5 text-right font-semibold ${tone}`}
                >
                  {line[column.key] || '—'}
                </td>
              )
            })}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function PlayerIdentity({ player, onCourt = false, ejected = false, fouled = false }: {
  player: MyAppearance
  onCourt?: boolean
  ejected?: boolean
  fouled?: boolean
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
      {player.teamLogo
        ? <img src={player.teamLogo} alt="" className="h-6 w-6 shrink-0 object-contain" />
        : <span className="h-6 w-6 shrink-0" />}
      <PlayerNameLink
        name={player.name}
        playerId={player.playerId}
        className="min-w-0 text-sm font-semibold text-gray-900 hover:underline dark:text-gray-100"
      />
      {player.position && <span className="shrink-0 text-[11px] text-gray-400">{player.position}</span>}
      <PlayerStatus onCourt={onCourt} ejected={ejected} fouledOut={fouled} />
    </div>
  )
}

function UpcomingCluster({ game, players, onOpenGame }: {
  game: BoxScoreGame
  players: MyAppearance[]
  onOpenGame: (gameId: string) => void
}) {
  return (
    <li className="px-4 py-2">
      <button
        type="button"
        onClick={() => onOpenGame(game.game_id)}
        className="text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400 hover:text-blue-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:hover:text-blue-300"
      >
        {matchup(game)} · {gameClockLabel(game.status, game.status_detail, game.start_time)}
      </button>
      <ul>
        {players.map(player => (
          <li key={player.playerId} className="py-1"><PlayerIdentity player={player} /></li>
        ))}
      </ul>
    </li>
  )
}

function ResultCluster({ game, players, hide, live, onOpenGame }: {
  game: BoxScoreGame
  players: MyAppearance[]
  hide: boolean
  live: boolean
  onOpenGame: (gameId: string) => void
}) {
  const box = useGetGameBoxScoreQuery(game.game_id, { pollingInterval: live ? 15_000 : 0 })
  const ready = box.data?.game_id === game.game_id ? box.data : undefined
  return (
    <li className="px-4 py-2">
      <button
        type="button"
        onClick={() => onOpenGame(game.game_id)}
        className={`text-left text-[11px] font-semibold uppercase tracking-wide hover:text-blue-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:hover:text-blue-300 ${live ? 'text-rose-600' : 'text-gray-400'}`}
      >
        {matchup(game)} · {gameClockLabel(game.status, game.status_detail, game.start_time)}
      </button>
      {box.isError && <p className="mt-1 text-xs text-rose-600">Could not load this box.</p>}
      {!hide && ready && players.some(player => myLine(ready, player.playerId).kind === 'played') && (
        <div className="mt-1 hidden lg:flex lg:items-end lg:gap-3">
          <div className="w-64 shrink-0" />
          <div className="min-w-0 flex-1">
            <table className="w-full table-fixed text-[11px]">
              <thead><StatLabels /></thead>
            </table>
          </div>
        </div>
      )}
      <ul>
        {players.map(player => {
          const found = ready ? myLine(ready, player.playerId) : null
          const note = hide
            ? 'Stats hidden'
            : !ready && !box.isError
              ? 'Loading line…'
              : found?.kind === 'dnp'
                ? `Did not play${found.reason ? ` · ${found.reason}` : ''}`
                : found?.kind === 'out'
                  ? 'Not in this box'
                  : ''
          return (
            <li key={player.playerId} className="flex flex-col py-1 lg:flex-row lg:items-center lg:gap-3">
              <div className="lg:w-64 lg:shrink-0">
                <PlayerIdentity
                  player={player}
                  onCourt={!hide && live && found?.kind === 'played' && found.line.on_court}
                  ejected={!hide && found?.kind === 'played' && found.line.ejected}
                  fouled={!hide && found?.kind === 'played' && fouledOut(found.line.pf)}
                />
              </div>
              <div className="min-w-0 w-full flex-1">
                {note && <p className="text-[11px] text-gray-400 lg:truncate">{note}</p>}
                {!hide && found?.kind === 'played' && <StatStrip line={found.line} hideLabelsOnWide />}
              </div>
            </li>
          )
        })}
      </ul>
    </li>
  )
}

function Group({ title, live = false, children }: { title: string; live?: boolean; children: ReactNode }) {
  return (
    <div className="border-t border-blue-100 dark:border-gray-800">
      <h3 className={`flex items-center gap-2 px-4 pt-3 text-[11px] font-semibold uppercase tracking-wide ${live ? 'text-rose-600' : 'text-gray-500 dark:text-gray-400'}`}>
        {live && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-rose-500" />}
        {title}
      </h3>
      <ul className="divide-y divide-blue-50 dark:divide-gray-800">{children}</ul>
    </div>
  )
}

/**
 * Every player from My Team who has a game on this slate. Lines for games
 * that have tipped stay hidden while No spoilers is on, until Show results.
 */
export default function MyPlayers({ groups, spoilerGuard, onOpenGame }: {
  groups: MyGroups
  spoilerGuard: boolean
  onOpenGame: (gameId: string) => void
}) {
  const hasResults = groups.live.length + groups.done.length > 0
  const [open, setOpen] = useState(false)
  const [shown, setShown] = useState(false)
  const hide = spoilerGuard && !shown
  const label = summary(groups)
  const upcoming = clusterByGame(groups.upcoming)
  const live = clusterByGame(groups.live)
  const done = clusterByGame(groups.done)
  const empty = !label

  return (
    <section aria-label="My players" className="mb-4 w-full overflow-hidden rounded-xl border border-blue-200 bg-white shadow-sm dark:border-blue-500/30 dark:bg-gray-900">
      <div className="flex items-center">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(current => !current)}
          className="flex min-w-0 flex-1 items-center justify-between gap-3 px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span aria-hidden="true" className="h-4 w-1 shrink-0 rounded-full bg-blue-600" />
            <span className="font-semibold text-gray-900 dark:text-gray-100">My players</span>
            {label && <span className="truncate text-xs font-normal text-gray-500 dark:text-gray-400">{label}</span>}
          </span>
          <span className="flex shrink-0 items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            {!open && spoilerGuard && hasResults && <span>Contains spoilers</span>}
            <Chevron open={open} />
          </span>
        </button>
        {open && spoilerGuard && hasResults && (
          <div className="shrink-0 pr-3">
            <button
              type="button"
              onClick={() => setShown(current => !current)}
              className="rounded-full px-3 py-1.5 text-xs font-semibold text-blue-700 ring-1 ring-blue-200 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:text-blue-300 dark:ring-blue-500/40 dark:hover:bg-blue-950"
            >
              {shown ? 'Hide results' : 'Show results'}
            </button>
          </div>
        )}
      </div>
      {open && empty && (
        <p className="border-t border-blue-100 px-4 py-4 text-sm text-gray-400 dark:border-gray-800">
          None of your players are on this slate.
        </p>
      )}
      {open && live.length > 0 && (
        <Group title="Playing" live>
          {live.map(cluster => (
            <ResultCluster key={cluster.game.game_id} game={cluster.game} players={cluster.players} hide={hide} live onOpenGame={onOpenGame} />
          ))}
        </Group>
      )}
      {open && upcoming.length > 0 && (
        <Group title="Yet to play">
          {upcoming.map(cluster => (
            <UpcomingCluster key={cluster.game.game_id} game={cluster.game} players={cluster.players} onOpenGame={onOpenGame} />
          ))}
        </Group>
      )}
      {open && done.length > 0 && (
        <Group title="Finished">
          {done.map(cluster => (
            <ResultCluster key={cluster.game.game_id} game={cluster.game} players={cluster.players} hide={hide} live={false} onOpenGame={onOpenGame} />
          ))}
        </Group>
      )}
    </section>
  )
}

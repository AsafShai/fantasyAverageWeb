import { useState } from 'react'
import PlayerNameLink from '../PlayerNameLink'
import { FantasyTeamTag, ZValue } from './BoxScorePanel'
import type { SlatePlayerValue } from '../../types/boxScore'

function statLine(player: SlatePlayerValue): string {
  const parts = [`${player.pts} PTS`, `${player.reb} REB`, `${player.ast} AST`]
  if (Number(player.stl) > 0) parts.push(`${player.stl} STL`)
  if (Number(player.blk) > 0) parts.push(`${player.blk} BLK`)
  const threes = player.fg3.split('-')[0]
  if (Number(threes) > 0) parts.push(`${threes} 3PM`)
  return parts.join(' · ')
}

function shooting(player: SlatePlayerValue): string {
  return [`${player.fg} FG`, `${player.ft} FT`].join(' · ')
}

/**
 * The five best lines of a finished slate, by z-score against every other
 * line that night. Collapsible; under No spoilers it starts closed.
 */
export default function LinesOfTheNight({ players, spoilerGuard }: { players: SlatePlayerValue[]; spoilerGuard: boolean }) {
  const [open, setOpen] = useState(!spoilerGuard)
  return (
    <section className="mb-4 overflow-hidden rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white shadow-sm dark:border-amber-500/30 dark:from-amber-950/40 dark:to-gray-900">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-400"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="text-lg">🔥</span>
          <span className="font-semibold text-gray-900 dark:text-gray-100">Lines of the night</span>
          <span className="hidden truncate text-xs text-gray-500 dark:text-gray-400 sm:inline">
            Top 5 by z-score across every game on the slate
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          {!open && spoilerGuard && <span>Contains spoilers</span>}
          <svg
            className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
          </svg>
        </span>
      </button>
      {open && (
        <ol className="divide-y divide-amber-100 border-t border-amber-100 dark:divide-gray-800 dark:border-gray-800">
          {players.map((player, index) => (
            <li key={`${player.game_id}-${player.player_id}`} className="flex items-center gap-3 px-4 py-2.5">
              <span className="w-5 shrink-0 text-center text-sm font-bold tabular-nums text-amber-600 dark:text-amber-400">
                {index + 1}
              </span>
              {player.team_logo
                ? <img src={player.team_logo} alt="" className="h-7 w-7 shrink-0 object-contain" />
                : <span className="h-7 w-7 shrink-0" />}
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <PlayerNameLink
                    name={player.name}
                    playerId={player.player_id}
                    className="truncate text-sm font-semibold text-gray-900 hover:underline dark:text-gray-100"
                  />
                  <FantasyTeamTag value={player} />
                </div>
                <p className="text-xs leading-snug text-gray-600 dark:text-gray-300">
                  {statLine(player)}
                </p>
                <p className="text-[11px] leading-snug text-gray-400">
                  {player.team_abbr} {player.is_home ? 'vs' : '@'} {player.opponent_abbr} · {player.min} min · {shooting(player)}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Z</p>
                <p className="text-base tabular-nums"><ZValue z={player.z} /></p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

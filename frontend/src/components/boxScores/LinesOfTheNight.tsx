import { useState } from 'react'
import PlayerNameLink from '../PlayerNameLink'
import { ShareCardButton } from '../share/ShareCardButton'
import { LinesOfTheNightShareCard } from '../share/LinesOfTheNightShareCard'
import { FantasyTeamTag, ZValue } from './BoxScorePanel'
import { lineSummary } from './linesOfTheNightFormat'
import type { SlatePlayerValue } from '../../types/boxScore'

const TOP = 5

function shooting(player: SlatePlayerValue): string {
  return [`${player.fg} FG`, `${player.ft} FT`].join(' · ')
}

type NightTab = 'lines' | 'fa'

const TABS: { id: NightTab; label: string; hint: string }[] = [
  { id: 'lines', label: 'Lines of the night', hint: 'Top 5 by z-score across every game on the slate' },
  { id: 'fa', label: 'FA of the night', hint: 'Top 5 unrostered in the league, by z-score' },
]

/**
 * The five best lines of a finished slate, by z-score against every other
 * line that night, plus the five best free agents. Starts closed.
 * `players` is the full slate, highest z-score first.
 */
export default function LinesOfTheNight({
  players,
  spoilerGuard,
  dateLabel,
  games,
}: {
  players: SlatePlayerValue[]
  spoilerGuard: boolean
  dateLabel: string
  games: number
}) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<NightTab>('lines')
  const lines = players.slice(0, TOP)
  const freeAgents = players.filter(player => player.fantasy_team == null).slice(0, TOP)
  const active = TABS.find(item => item.id === tab) ?? TABS[0]
  const shown = tab === 'lines' ? lines : freeAgents

  return (
    <section className="mb-4 overflow-hidden rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white shadow-sm dark:border-amber-500/30 dark:from-amber-950/40 dark:to-gray-900">
      <div className="flex items-center">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
        className="flex min-w-0 flex-1 items-center justify-between gap-3 px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-400"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="text-lg">🔥</span>
          <span className="font-semibold text-gray-900 dark:text-gray-100">Lines of the night</span>
          <span className="hidden truncate text-xs text-gray-500 dark:text-gray-400 sm:inline">
            Top 5 lines and the top 5 free agents
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
      {open && shown.length > 0 && (
        <div className="shrink-0 pr-3">
          <ShareCardButton
            title={active.label}
            contentKey={tab}
            renderCard={({ dark }) => (
              <LinesOfTheNightShareCard
                dark={dark}
                dateLabel={dateLabel}
                games={games}
                players={shown}
                title={active.label}
              />
            )}
          />
        </div>
      )}
      </div>
      {open && (
        <>
          <div role="tablist" aria-label="Night rankings" className="flex gap-1 border-t border-amber-100 px-3 pt-2 dark:border-gray-800">
            {TABS.map(item => {
              const selected = item.id === tab
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  id={`night-tab-${item.id}`}
                  aria-controls="night-tab-panel"
                  aria-selected={selected}
                  onClick={() => setTab(item.id)}
                  className={`rounded-t px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                    selected
                      ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-gray-100'
                      : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
                  }`}
                >
                  {item.label}
                </button>
              )
            })}
          </div>
          <p className="px-4 pb-2 text-[11px] text-gray-500 dark:text-gray-400">{active.hint}</p>
          {shown.length > 0 ? (
            <ol id="night-tab-panel" role="tabpanel" aria-labelledby={`night-tab-${tab}`} className="divide-y divide-amber-100 border-t border-amber-100 dark:divide-gray-800 dark:border-gray-800">
              {shown.map((player, index) => (
                <li key={`${player.game_id}-${player.player_id}`} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="w-5 shrink-0 text-center text-sm font-bold tabular-nums text-amber-600 dark:text-amber-400">
                    {index + 1}
                  </span>
                  {player.team_logo
                    ? <img src={player.team_logo} alt="" className="h-7 w-7 shrink-0 object-contain" />
                    : <span className="h-7 w-7 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                      <PlayerNameLink
                        name={player.name}
                        playerId={player.player_id}
                        className="truncate text-sm font-semibold text-gray-900 hover:underline dark:text-gray-100"
                      />
                      <FantasyTeamTag value={player} full />
                    </div>
                    <p className="text-xs leading-snug text-gray-600 dark:text-gray-300">
                      {lineSummary(player)}
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
          ) : (
            <p id="night-tab-panel" role="tabpanel" aria-labelledby={`night-tab-${tab}`} className="border-t border-amber-100 px-4 py-6 text-center text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
              No unrostered players on this slate.
            </p>
          )}
        </>
      )}
    </section>
  )
}

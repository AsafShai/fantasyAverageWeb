import { useMemo, useState, type ReactNode } from 'react'
import PlayerNameLink from '../PlayerNameLink'
import { useGetGameBoxScoreQuery } from '../../store/api/fantasyApi'
import { BOX_LINE_COLUMNS, FantasyTeamTag, JerseyNumber, LiveMark, OnCourtMark, PlayerStatus } from './BoxScorePanel'
import { resolveFantasyContext } from './fantasyLineupMark'
import { fouledOut } from './lineupGroups'
import { FANTASY_LINEUP_DOT_CLASS } from './fantasyLineupMark'
import { clusterByGame, filterMyGroups, isFantasyActiveLineup, myLine, mySlateCategoryTotals, mySlateTotals, type MyAppearance, type MyGroups, type MySlateCategoryTotals, type MySlateTotals } from './myPlayerGroups'
import { orderCategories } from '../../utils/statOrder'
import { CATEGORY_LABELS } from '../../utils/playerRankings'
import { gameClockLabel } from './tipTime'
import type { BoxPlayerLine, BoxScoreGame, FantasyNightContext, SlatePlayerValue } from '../../types/boxScore'

function groupSummary(groups: MyGroups): string {
  const parts = [
    groups.live.length > 0 ? `${groups.live.length} playing` : '',
    groups.upcoming.length > 0 ? `${groups.upcoming.length} yet to play` : '',
    groups.done.length > 0 ? `${groups.done.length} finished` : '',
  ].filter(Boolean)
  return parts.join(' · ')
}

function GameHeading({ game, hideScore = false }: { game: BoxScoreGame; hideScore?: boolean }) {
  const clock = gameClockLabel(game.status, game.status_detail, game.start_time, hideScore)
  const scored = !hideScore && game.away.score != null && game.home.score != null
  return (
    <>
      {game.away.abbreviation}
      {scored && <>{' '}<span className="tabular-nums">{game.away.score}</span></>}
      {' @ '}
      {game.home.abbreviation}
      {scored && <>{' '}<span className="tabular-nums">{game.home.score}</span></>}
      {` · ${clock}`}
    </>
  )
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

function PlayerIdentity({ player, jersey = '', live = false, onCourt = false, ejected = false, fouled = false, fantasyPlayers }: {
  player: MyAppearance
  jersey?: string
  live?: boolean
  onCourt?: boolean
  ejected?: boolean
  fouled?: boolean
  fantasyPlayers?: Record<string, FantasyNightContext>
}) {
  const fantasy = resolveFantasyContext(player.playerId, undefined, fantasyPlayers)
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
      {player.teamLogo
        ? <img src={player.teamLogo} alt="" className="h-6 w-6 shrink-0 object-contain" />
        : <span className="h-6 w-6 shrink-0" />}
      <JerseyNumber jersey={jersey} />
      <PlayerNameLink
        name={player.name}
        playerId={player.playerId}
        className="min-w-0 text-sm font-semibold text-gray-900 hover:underline dark:text-gray-100"
      />
      {player.position && <span className="shrink-0 text-[11px] text-gray-400">{player.position}</span>}
      {live && <LiveMark />}
      {onCourt && <OnCourtMark />}
      <PlayerStatus ejected={ejected} fouledOut={fouled} />
      {fantasy && <FantasyTeamTag value={fantasy} />}
    </div>
  )
}

function UpcomingCluster({ game, players, onOpenGame, fantasyPlayers }: {
  game: BoxScoreGame
  players: MyAppearance[]
  onOpenGame: (gameId: string) => void
  fantasyPlayers?: Record<string, FantasyNightContext>
}) {
  return (
    <li className="px-4 py-2">
      <button
        type="button"
        onClick={() => onOpenGame(game.game_id)}
        className="text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400 hover:text-blue-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:hover:text-blue-300"
      >
        <GameHeading game={game} />
      </button>
      <ul>
        {players.map(player => (
          <li key={player.playerId} className="py-1"><PlayerIdentity player={player} fantasyPlayers={fantasyPlayers} /></li>
        ))}
      </ul>
    </li>
  )
}

function ResultCluster({ game, players, hide, live, onOpenGame, fantasyPlayers }: {
  game: BoxScoreGame
  players: MyAppearance[]
  hide: boolean
  live: boolean
  onOpenGame: (gameId: string) => void
  fantasyPlayers?: Record<string, FantasyNightContext>
}) {
  const box = useGetGameBoxScoreQuery(game.game_id, { pollingInterval: live ? 60_000 : 0 })
  const ready = box.data?.game_id === game.game_id ? box.data : undefined
  return (
    <li className="px-4 py-2">
      <button
        type="button"
        onClick={() => onOpenGame(game.game_id)}
        className={`text-left text-[11px] font-semibold uppercase tracking-wide hover:text-blue-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:hover:text-blue-300 ${live ? 'text-rose-600' : 'text-gray-400'}`}
      >
        <GameHeading game={game} hideScore={hide} />
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
                  jersey={found?.kind === 'played' ? found.line.jersey : found?.kind === 'dnp' ? found.jersey : ''}
                  live={!hide && live}
                  onCourt={!hide && live && found?.kind === 'played' && found.line.on_court}
                  ejected={!hide && found?.kind === 'played' && found.line.ejected}
                  fouled={!hide && found?.kind === 'played' && fouledOut(found.line.pf)}
                  fantasyPlayers={fantasyPlayers}
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
function shootingPct(made: number, attempted: number): string | undefined {
  if (attempted <= 0) return undefined
  return `${((100 * made) / attempted).toFixed(1)}%`
}

function formatCategoryTotal(cat: string, value: number): string {
  if (cat.endsWith('%')) return `${(value * 100).toFixed(1)}%`
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10)
}

type SlateTotalView = 'all' | 'categories'

function slateItemsAll(totals: MySlateTotals): { label: string; main: string; sub?: string }[] {
  return [
    { label: 'MIN', main: String(Math.round(totals.min)) },
    { label: 'PTS', main: String(totals.pts) },
    { label: 'FG', main: `${totals.fgm}-${totals.fga}`, sub: shootingPct(totals.fgm, totals.fga) },
    { label: '3PT', main: `${totals.threePm}-${totals.fg3a}`, sub: shootingPct(totals.threePm, totals.fg3a) },
    { label: 'FT', main: `${totals.ftm}-${totals.fta}`, sub: shootingPct(totals.ftm, totals.fta) },
    { label: 'REB', main: String(totals.reb) },
    { label: 'AST', main: String(totals.ast) },
    { label: 'TO', main: String(totals.tov) },
    { label: 'STL', main: String(totals.stl) },
    { label: 'BLK', main: String(totals.blk) },
    { label: 'OREB', main: String(totals.oreb) },
    { label: 'DREB', main: String(totals.dreb) },
    { label: 'PF', main: String(totals.pf) },
  ]
}

const CATEGORY_SHOOTING_LABEL: Record<string, string> = {
  'FG%': 'FG',
  'FT%': 'FT',
  '3P%': '3PT',
}

function slateItemsCategories(totals: MySlateCategoryTotals, leagueCategories: string[]): { label: string; main: string; sub?: string }[] {
  const ordered = orderCategories(leagueCategories)
  return [
    { label: 'MIN', main: String(Math.round(totals.min)) },
    ...ordered.map(cat => {
      const shot = totals.shooting[cat as keyof typeof totals.shooting]
      if (shot) {
        return {
          label: CATEGORY_SHOOTING_LABEL[cat] ?? (CATEGORY_LABELS[cat] ?? cat),
          main: `${shot.made}-${shot.att}`,
          sub: shootingPct(shot.made, shot.att),
        }
      }
      return {
        label: CATEGORY_LABELS[cat] ?? cat,
        main: formatCategoryTotal(cat, totals.categories[cat] ?? 0),
      }
    }),
  ]
}

function SlateTotalBar({
  totals,
  categoryTotals,
  leagueCategories,
  view,
  onViewChange,
  activeOnly,
  live,
}: {
  totals: MySlateTotals
  categoryTotals: MySlateCategoryTotals | null
  leagueCategories: string[]
  view: SlateTotalView
  onViewChange: (view: SlateTotalView) => void
  activeOnly: boolean
  /** Games are still in progress, so the totals are running and will keep changing. */
  live: boolean
}) {
  const canShowCategories = categoryTotals != null && leagueCategories.length > 0
  const items = view === 'categories' && canShowCategories
    ? slateItemsCategories(categoryTotals, leagueCategories)
    : slateItemsAll(totals)
  const catLabel = leagueCategories.length === 8 ? '8 categories' : 'Categories'
  return (
    <footer className="border-t border-blue-200 bg-blue-50/60 px-4 py-3 dark:border-blue-500/30 dark:bg-blue-950/40">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-800 dark:text-blue-200">
          {live ? 'Slate total so far' : 'Slate total'}
          <span className="font-normal normal-case text-gray-600 dark:text-gray-400">
            {' · '}
            {totals.players} played
            {activeOnly ? ' (active lineup)' : ''}
          </span>
        </p>
        {canShowCategories && (
          <div
            role="group"
            aria-label="Slate total stat columns"
            className="inline-flex rounded-full bg-blue-100/80 p-0.5 ring-1 ring-blue-200 dark:bg-gray-800 dark:ring-gray-700"
          >
            <button
              type="button"
              aria-pressed={view === 'all'}
              onClick={() => onViewChange('all')}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                view === 'all'
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-gray-100'
                  : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
              }`}
            >
              All stats
            </button>
            <button
              type="button"
              aria-pressed={view === 'categories'}
              onClick={() => onViewChange('categories')}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                view === 'categories'
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-gray-100'
                  : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
              }`}
            >
              {catLabel}
            </button>
          </div>
        )}
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[32rem] table-fixed text-[11px] lg:min-w-full">
          <caption className="sr-only">Combined box line for my players this slate</caption>
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {items.map(({ label }) => (
                <th key={label} className="px-1 py-0.5 text-right font-medium">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="tabular-nums font-semibold text-gray-900 dark:text-gray-100">
              {items.map(({ label, main, sub }) => (
                <td key={label} className="whitespace-nowrap px-1 py-0.5 text-right align-top">
                  <span className="block">{main}</span>
                  {sub && (
                    <span className="block text-[10px] font-normal text-gray-500 dark:text-gray-400">{sub}</span>
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </footer>
  )
}

export default function MyPlayers({ groups, spoilerGuard, onOpenGame, fantasyPlayers, playerValues, leagueCategories, slateComplete = false }: {
  groups: MyGroups
  spoilerGuard: boolean
  onOpenGame: (gameId: string) => void
  fantasyPlayers?: Record<string, FantasyNightContext>
  playerValues?: Map<string, SlatePlayerValue>
  /** League scoring categories from the slate values response (for the category total view). */
  leagueCategories?: string[]
  /** Every game on the slate is final. While false, the slate total is shown as a live running total. */
  slateComplete?: boolean
}) {
  const hasResults = groups.live.length + groups.done.length > 0
  const [open, setOpen] = useState(false)
  const [shown, setShown] = useState(false)
  const [activeOnly, setActiveOnly] = useState(false)
  const [slateTotalView, setSlateTotalView] = useState<SlateTotalView>('all')
  const hide = spoilerGuard && !shown
  const canFilterLineup = Boolean(fantasyPlayers && Object.keys(fantasyPlayers).length > 0)
  const visibleGroups = useMemo(() => {
    if (!activeOnly || !canFilterLineup) return groups
    const keepActive = (row: MyAppearance) => isFantasyActiveLineup(row.playerId, fantasyPlayers, playerValues)
    return filterMyGroups(groups, keepActive)
  }, [activeOnly, canFilterLineup, fantasyPlayers, groups, playerValues])
  const label = groupSummary(visibleGroups)
  const upcoming = clusterByGame(visibleGroups.upcoming)
  const live = clusterByGame(visibleGroups.live)
  const done = clusterByGame(visibleGroups.done)
  const rosteredOnSlate = groups.upcoming.length + groups.live.length + groups.done.length
  const empty = rosteredOnSlate === 0
  const filteredEmpty = !empty && activeOnly && !label
  const finishedAppearances = useMemo(
    () => [...visibleGroups.done, ...visibleGroups.live],
    [visibleGroups.done, visibleGroups.live],
  )
  const slateTotals = useMemo(
    () => mySlateTotals(finishedAppearances, playerValues),
    [finishedAppearances, playerValues],
  )
  const slateCategoryTotals = useMemo(
    () => (leagueCategories?.length
      ? mySlateCategoryTotals(finishedAppearances, playerValues, leagueCategories)
      : null),
    [finishedAppearances, playerValues, leagueCategories],
  )

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
      {open && canFilterLineup && !empty && (
        <div className="flex flex-wrap items-center gap-2 border-t border-blue-100 px-4 py-2 dark:border-gray-800">
          <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">Show</span>
          <div
            role="group"
            aria-label="Which of my players to list"
            className="inline-flex rounded-full bg-blue-50 p-0.5 ring-1 ring-blue-100 dark:bg-gray-800 dark:ring-gray-700"
          >
            <button
              type="button"
              aria-pressed={!activeOnly}
              onClick={() => setActiveOnly(false)}
              className={`rounded-full px-2.5 py-1 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                !activeOnly
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-gray-100'
                  : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
              }`}
            >
              Full roster
            </button>
            <button
              type="button"
              aria-pressed={activeOnly}
              onClick={() => setActiveOnly(true)}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                activeOnly
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-gray-100'
                  : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
              }`}
            >
              <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${FANTASY_LINEUP_DOT_CLASS.started}`} aria-hidden />
              Active lineup
            </button>
          </div>
        </div>
      )}
      {open && empty && (
        <p className="border-t border-blue-100 px-4 py-4 text-sm text-gray-400 dark:border-gray-800">
          None of your players are on this slate.
        </p>
      )}
      {open && filteredEmpty && (
        <p className="border-t border-blue-100 px-4 py-4 text-sm text-gray-400 dark:border-gray-800">
          No active-lineup players on this slate. Bench and IR are hidden — switch to Full roster to see everyone.
        </p>
      )}
      {open && live.length > 0 && (
        <Group title="Playing" live>
          {live.map(cluster => (
            <ResultCluster key={cluster.game.game_id} game={cluster.game} players={cluster.players} hide={hide} live onOpenGame={onOpenGame} fantasyPlayers={fantasyPlayers} />
          ))}
        </Group>
      )}
      {open && upcoming.length > 0 && (
        <Group title="Yet to play">
          {upcoming.map(cluster => (
            <UpcomingCluster key={cluster.game.game_id} game={cluster.game} players={cluster.players} onOpenGame={onOpenGame} fantasyPlayers={fantasyPlayers} />
          ))}
        </Group>
      )}
      {open && done.length > 0 && (
        <Group title="Finished">
          {done.map(cluster => (
            <ResultCluster key={cluster.game.game_id} game={cluster.game} players={cluster.players} hide={hide} live={false} onOpenGame={onOpenGame} fantasyPlayers={fantasyPlayers} />
          ))}
        </Group>
      )}
      {open && slateTotals && !hide && (
        <SlateTotalBar
          totals={slateTotals}
          categoryTotals={slateCategoryTotals}
          leagueCategories={leagueCategories ?? []}
          view={slateTotalView}
          onViewChange={setSlateTotalView}
          activeOnly={activeOnly && canFilterLineup}
          live={!slateComplete}
        />
      )}
      {open && slateTotals && hide && (
        <p className="border-t border-blue-100 px-4 py-3 text-[11px] text-gray-400 dark:border-gray-800">
          Show results to see the slate total for my players.
        </p>
      )}
    </section>
  )
}

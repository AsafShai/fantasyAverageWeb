import { useMemo, useState } from 'react'
import type { LeagueActivity } from '../../types/activity'
import { useMyTeam } from '../../context/MyTeamContext'
import PlayerNameLink from '../PlayerNameLink'
import InfoTip from '../InfoTip'
import {
  SMALL_SAMPLE_GAMES,
  buildTradeTree,
  formatDay,
  missedGames,
  perGameSummary,
  type TreeStint,
} from '../../utils/leagueActivity'
import { Pill, SELECT_CLASS } from './shared'
import { teamAbbrev, teamLookup, type TeamLookup } from './teams'

// Only a guard against runaway chains; real ones are a handful of trades deep.
const MAX_DEPTH = 50
// A tree up to this many players opens fully. A bigger one opens one level of
// follow-up trades (what each player got was flipped for) and folds the rest.
const AUTO_EXPAND_MAX_PLAYERS = 8

interface TradeTreeProps {
  activity: LeagueActivity
  tradeId: string | null
  teamId: number | null
  onChange: (tradeId: string, teamId: number) => void
  onSelectTrade: (id: string) => void
}

const NODE = 'inline-grid max-w-full gap-0.5 rounded-md border px-2.5 py-1.5 text-sm'

// A follow-up trade hangs off the stint of the player who was traded on, so
// that stint identifies it even when one onward trade took two players.
const stintKey = (s: { player_id: number; start: string }) => `${s.player_id}-${s.start}`

function countStints(nodes: TreeStint[]): number {
  return nodes.reduce((n, { next }) => n + 1 + (next ? countStints(next.received) : 0), 0)
}

/** Follow-ups folded when a tree first opens: none for a small tree, every one
 * below the first level for a bigger one. */
function defaultCollapsed(root: TreeStint[], players: number): Set<string> {
  if (players <= AUTO_EXPAND_MAX_PLAYERS) return new Set()
  return new Set(root.flatMap(({ next }) => (next && !next.shownWith ? followUpKeys(next.received) : [])))
}

function followUpKeys(nodes: TreeStint[]): string[] {
  return nodes.flatMap(({ stint, next }) =>
    next && !next.shownWith ? [stintKey(stint), ...followUpKeys(next.received)] : [],
  )
}

interface BranchProps {
  nodes: TreeStint[]
  teams: TeamLookup
  teamId: number
  seasonOver: boolean
  collapsed: Set<string>
  onToggle: (key: string) => void
  onSelectTrade: (id: string) => void
}

function Branch(props: BranchProps) {
  const { nodes, teams, teamId, seasonOver, collapsed, onToggle, onSelectTrade } = props
  const abbrev = teamAbbrev(teams, teamId)
  return (
    <ul className="space-y-1 border-l border-gray-300 pl-3 sm:pl-5 dark:border-gray-600">
      {nodes.map(({ stint: s, next }) => {
        const key = stintKey(s)
        const isCollapsed = collapsed.has(key)
        // Folded label: the players this trade brought back, and everyone
        // further down the branch when that's more.
        const direct = next ? next.received.length : 0
        const hidden = next ? countStints(next.received) : 0
        return (
        <li key={key} className="relative pt-1 before:absolute before:top-5 before:-left-3 before:w-2 sm:before:-left-5 sm:before:w-4 before:border-t before:border-gray-300 dark:before:border-gray-600">
          <div className={`${NODE} border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800`}>
            <span className="flex flex-wrap items-center gap-1.5 font-semibold text-gray-900 dark:text-gray-100">
              <PlayerNameLink name={s.name} playerId={s.player_id} className="-my-1 inline-block py-1 hover:underline" />
              {s.games_played < SMALL_SAMPLE_GAMES ? <Pill tone="warn">Small sample</Pill> : missedGames(s) && <Pill tone="warn">Missed games</Pill>}
            </span>
            <span className="text-xs text-gray-600 tabular-nums dark:text-gray-300">
              {formatDay(s.start)} – {formatDay(s.end)} · {s.games_played} GP for {abbrev} · {perGameSummary(s)}
            </span>
          </div>
          {next ? (
            <ul className="mt-1 border-l border-gray-300 pl-3 sm:pl-5 dark:border-gray-600">
              <li className="relative pt-1 before:absolute before:top-5 before:-left-3 before:w-2 sm:before:-left-5 sm:before:w-4 before:border-t before:border-gray-300 dark:before:border-gray-600">
                <div className="flex max-w-full items-start gap-1.5">
                  {!next.shownWith && (
                    <button
                      type="button"
                      onClick={() => onToggle(key)}
                      aria-expanded={!isCollapsed}
                      aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} trade to ${teamAbbrev(teams, next.otherTeamId)} on ${formatDay(next.trade.date)}`}
                      className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                    >
                      <span aria-hidden="true" className={`inline-block text-xs transition-transform ${isCollapsed ? '-rotate-90' : ''}`}>▼</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onSelectTrade(next.trade.id)}
                    className={`${NODE} min-w-0 border-gray-300 bg-gray-50 text-left hover:border-blue-400 dark:border-gray-600 dark:bg-gray-700`}
                  >
                    <span className="font-semibold text-gray-900 dark:text-gray-100">
                      Traded to {teamAbbrev(teams, next.otherTeamId)} · {formatDay(next.trade.date)}
                    </span>
                    <span className="text-xs text-gray-600 dark:text-gray-300">
                      {!next.shownWith && next.sentAlongside.length > 0 && `sent with ${next.sentAlongside.map(p => p.name).join(', ')}; `}
                      {next.shownWith ? `Same trade as ${next.shownWith} (shown above)` : <>{abbrev} got back
                      {isCollapsed
                        ? ` ${direct} ${direct === 1 ? 'player' : 'players'} (${hidden > direct ? `${hidden} in this branch, ` : ''}hidden)`
                        : ':'}</>}
                    </span>
                  </button>
                </div>
                {!isCollapsed && !next.shownWith && <Branch {...props} nodes={next.received} />}
              </li>
            </ul>
          ) : (
            <ul className="mt-1 border-l border-gray-300 pl-3 sm:pl-5 dark:border-gray-600">
              <li className="relative pt-1 before:absolute before:top-5 before:-left-3 before:w-2 sm:before:-left-5 sm:before:w-4 before:border-t before:border-gray-300 dark:before:border-gray-600">
                {s.exit === 'released' ? (
                  <>
                    <div className={`${NODE} border-dashed border-gray-400 text-gray-700 dark:border-gray-500 dark:text-gray-300`}>
                      Released {formatDay(s.end)}
                    </div>
                    {s.picked_up_after && (
                      <ul className="mt-1 border-l border-dotted border-gray-300 pl-3 sm:pl-5 dark:border-gray-600">
                        <li className="pt-1">
                          <div className={`${NODE} border-dotted border-gray-400 text-gray-500 dark:border-gray-500 dark:text-gray-400`}>
                            <span>┄ {teamAbbrev(teams, s.picked_up_after.team_id)} picked him up {formatDay(s.picked_up_after.date)}</span>
                            <span className="text-xs">{s.picked_up_after.games_played} GP there · not counted for this trade</span>
                          </div>
                        </li>
                      </ul>
                    )}
                  </>
                ) : (
                  <div className={`${NODE} border-gray-300 text-gray-700 dark:border-gray-600 dark:text-gray-300`}>
                    {seasonOver ? `On ${abbrev} at season end` : `Still on ${abbrev}`}
                  </div>
                )}
              </li>
            </ul>
          )}
        </li>
        )
      })}
    </ul>
  )
}

const TradeTree = ({ activity, tradeId, teamId, onChange, onSelectTrade }: TradeTreeProps) => {
  const { myTeamId } = useMyTeam()
  const teams = useMemo(() => teamLookup(activity.teams), [activity.teams])
  const trades = activity.trades
  const trade = trades.find(t => t.id === tradeId) ?? trades[trades.length - 1]
  // The side asked for in the URL; otherwise my team's side when it was in the
  // trade (usually the question), otherwise the first team.
  const inTrade = (id: number | null) => id != null && !!trade?.sides.some(s => s.team_id === id)
  const follow = inTrade(teamId) ? (teamId as number) : inTrade(myTeamId) ? (myTeamId as number) : trade?.sides[0]?.team_id
  const tree = useMemo(
    () => (trade && follow != null ? buildTradeTree(trades, trade.id, follow, MAX_DEPTH) : null),
    [trades, trade, follow],
  )
  // Follow-up trades folded away for the tree currently shown; until the viewer
  // toggles one, the size-based default applies.
  const [collapsedState, setCollapsedState] = useState<{ tree: string; keys: Set<string> } | null>(null)
  const treeKey = `${trade?.id}:${follow}`
  const collapsed = useMemo(
    () =>
      collapsedState?.tree === treeKey
        ? collapsedState.keys
        : tree
          ? defaultCollapsed(tree.root, tree.stints)
          : new Set<string>(),
    [collapsedState, treeKey, tree],
  )
  const setCollapsed = (keys: Set<string>) => setCollapsedState({ tree: treeKey, keys })
  const toggle = (key: string) => {
    const next = new Set(collapsed)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setCollapsed(next)
  }

  if (!trade || follow == null || !tree) {
    return (
      <div className="rounded-lg bg-white p-6 text-center text-sm text-gray-500 shadow-md dark:bg-gray-800 dark:text-gray-400">
        No trades yet this season, so there is no tree to show.
      </div>
    )
  }
  const abbrev = teamAbbrev(teams, follow)
  const allFollowUps = followUpKeys(tree.root)
  const other = trade.sides.find(s => s.team_id !== follow)
  const sent = other?.received ?? []
  const otherAbbrev = teamAbbrev(teams, other?.team_id ?? 0)
  const names = (stints: { name: string }[]) => (stints.length ? stints.map(p => p.name).join(', ') : 'No players')

  return (
    <div className="space-y-4 rounded-lg bg-white p-4 shadow-md dark:bg-gray-800">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-700 dark:text-gray-300">
        <label className="flex min-w-0 items-center gap-2">
          Trade
          <select
            id="tree-trade"
            className={`${SELECT_CLASS} max-w-[16rem]`}
            value={trade.id}
            onChange={e => onChange(e.target.value, 0)}
          >
            {[...trades].reverse().map(t => (
              <option key={t.id} value={t.id}>
                {formatDay(t.date)} · {teamAbbrev(teams, t.sides[0].team_id)} ⇄ {teamAbbrev(teams, t.sides[1].team_id)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-2">
          <span id="tree-follow-label">Follow</span>
          <div role="group" aria-labelledby="tree-follow-label" className="flex overflow-hidden rounded-lg border border-gray-300 dark:border-gray-600">
            {trade.sides.map(s => (
              <button
                key={s.team_id}
                type="button"
                aria-pressed={s.team_id === follow}
                title={teams.get(s.team_id)?.name}
                onClick={() => onChange(trade.id, s.team_id)}
                className={`min-w-[4.5rem] px-3 py-1.5 font-medium ${
                  s.team_id === follow ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 dark:bg-gray-700 dark:text-gray-200'
                }`}
              >
                {teamAbbrev(teams, s.team_id)}
                {s.team_id === myTeamId && <span className="ml-1 text-[10px] font-semibold uppercase opacity-80">you</span>}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* The followed trade is the title; what came back hangs under it. */}
      <div className="space-y-1">
        <h2 className="flex items-center gap-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
          <button type="button" onClick={() => onSelectTrade(trade.id)} className="text-left hover:underline">
            {abbrev} ⇄ {otherAbbrev} · {formatDay(trade.date)}
          </button>
          <InfoTip
            title="Trade tree"
            body={`Follows the players ${abbrev} got in this trade. When one was traded on, the branch continues with what came back. Stats count only games played for ${abbrev}.`}
          />
        </h2>
        {/* Both sides of the trade, before the tree follows what came back. */}
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">
          <dt className="font-semibold whitespace-nowrap text-gray-500 dark:text-gray-400">Sent to {otherAbbrev}</dt>
          <dd className="min-w-0 text-gray-900 dark:text-gray-100">{names(sent)}</dd>
          <dt className="font-semibold whitespace-nowrap text-gray-500 dark:text-gray-400">Got from {otherAbbrev}</dt>
          <dd className="min-w-0 text-gray-900 dark:text-gray-100">{names(tree.root.map(n => n.stint))}</dd>
        </dl>
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <p className="text-sm text-gray-600 tabular-nums dark:text-gray-400">
            {tree.stints} players · {tree.games} GP for {abbrev}
          </p>
          {allFollowUps.length > 0 && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setCollapsed(new Set(allFollowUps))}
                disabled={collapsed.size === allFollowUps.length}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                Collapse all
              </button>
              <button
                type="button"
                onClick={() => setCollapsed(new Set())}
                disabled={collapsed.size === 0}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                Expand all
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="overflow-x-auto pb-1">
        {tree.root.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">{abbrev} got no players back.</p>
        ) : (
          <>
            <Branch
              nodes={tree.root}
              teams={teams}
              teamId={follow}
              seasonOver={activity.season_over}
              collapsed={collapsed}
              onToggle={toggle}
              onSelectTrade={onSelectTrade}
            />
          </>
        )}
      </div>
    </div>
  )
}

export default TradeTree

import { useMemo, useState } from 'react'
import type { LeagueActivity } from '../../types/activity'
import { useMyTeam } from '../../context/MyTeamContext'
import { fantasyTeamOptionLabel } from '../MyTeamMark'
import PlayerNameLink from '../PlayerNameLink'
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

// Chains in this league run long (17 trades when both sides are followed), so
// the tree opens three trades deep and grows on request.
const INITIAL_DEPTH = 3

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

function followUpKeys(nodes: TreeStint[]): string[] {
  return nodes.flatMap(({ stint, next }) => (next ? [stintKey(stint), ...followUpKeys(next.received)] : []))
}

interface BranchProps {
  nodes: TreeStint[]
  teams: TeamLookup
  teamId: number
  seasonOver: boolean
  truncated: Set<string>
  collapsed: Set<string>
  onToggle: (key: string) => void
  onExpand: () => void
  onSelectTrade: (id: string) => void
}

function Branch(props: BranchProps) {
  const { nodes, teams, teamId, seasonOver, truncated, collapsed, onToggle, onExpand, onSelectTrade } = props
  const abbrev = teamAbbrev(teams, teamId)
  return (
    <ul className="space-y-1 border-l border-gray-300 pl-3 sm:pl-5 dark:border-gray-600">
      {nodes.map(({ stint: s, next }) => {
        const key = stintKey(s)
        const isCollapsed = collapsed.has(key)
        const hidden = next && !truncated.has(next.trade.id) ? countStints(next.received) : 0
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
                  <button
                    type="button"
                    onClick={() => onToggle(key)}
                    aria-expanded={!isCollapsed}
                    aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} trade to ${teamAbbrev(teams, next.otherTeamId)} on ${formatDay(next.trade.date)}`}
                    className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    <span aria-hidden="true" className={`inline-block text-xs transition-transform ${isCollapsed ? '-rotate-90' : ''}`}>▼</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectTrade(next.trade.id)}
                    className={`${NODE} min-w-0 border-gray-300 bg-gray-50 text-left hover:border-blue-400 dark:border-gray-600 dark:bg-gray-700`}
                  >
                    <span className="font-semibold text-gray-900 dark:text-gray-100">
                      Traded to {teamAbbrev(teams, next.otherTeamId)} · {formatDay(next.trade.date)}
                    </span>
                    <span className="text-xs text-gray-600 dark:text-gray-300">
                      {next.sentAlongside.length > 0 && `sent with ${next.sentAlongside.map(p => p.name).join(', ')}; `}
                      {abbrev} got back
                      {isCollapsed
                        ? truncated.has(next.trade.id)
                          ? ' (hidden)'
                          : ` ${hidden} ${hidden === 1 ? 'player' : 'players'} (hidden)`
                        : ':'}
                    </span>
                  </button>
                </div>
                {isCollapsed ? null : truncated.has(next.trade.id) ? (
                  <div className="mt-1 pl-3 sm:pl-5">
                    <button
                      type="button"
                      onClick={onExpand}
                      className="rounded-md border border-gray-300 px-2.5 py-1 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                    >
                      Show what that turned into
                    </button>
                  </div>
                ) : (
                  <Branch {...props} nodes={next.received} />
                )}
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
  const { isMyTeam } = useMyTeam()
  const teams = useMemo(() => teamLookup(activity.teams), [activity.teams])
  const trades = activity.trades
  const trade = trades.find(t => t.id === tradeId) ?? trades[trades.length - 1]
  const follow = trade?.sides.some(s => s.team_id === teamId) ? (teamId as number) : trade?.sides[0]?.team_id
  const [depth, setDepth] = useState(INITIAL_DEPTH)
  // Follow-up trades the viewer folded away, for the tree currently shown.
  const [collapsedState, setCollapsedState] = useState<{ tree: string; keys: Set<string> }>({ tree: '', keys: new Set() })
  const treeKey = `${trade?.id}:${follow}`
  const collapsed = collapsedState.tree === treeKey ? collapsedState.keys : new Set<string>()
  const setCollapsed = (keys: Set<string>) => setCollapsedState({ tree: treeKey, keys })
  const toggle = (key: string) => {
    const next = new Set(collapsed)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setCollapsed(next)
  }

  const tree = useMemo(
    () => (trade && follow != null ? buildTradeTree(trades, trade.id, follow, depth) : null),
    [trades, trade, follow, depth],
  )

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

  return (
    <div className="space-y-4 rounded-lg bg-white p-4 shadow-md dark:bg-gray-800">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-700 dark:text-gray-300">
        <label className="flex min-w-0 items-center gap-2">
          Trade
          <select
            id="tree-trade"
            className={`${SELECT_CLASS} max-w-[16rem]`}
            value={trade.id}
            onChange={e => {
              setDepth(INITIAL_DEPTH)
              onChange(e.target.value, follow)
            }}
          >
            {[...trades].reverse().map(t => (
              <option key={t.id} value={t.id}>
                {formatDay(t.date)} · {teamAbbrev(teams, t.sides[0].team_id)} ⇄ {teamAbbrev(teams, t.sides[1].team_id)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          Follow
          <select id="tree-team" className={SELECT_CLASS} value={follow} onChange={e => onChange(trade.id, Number(e.target.value))}>
            {trade.sides.map(s => (
              <option key={s.team_id} value={s.team_id}>
                {fantasyTeamOptionLabel(teams.get(s.team_id)?.name ?? abbrev, isMyTeam(s.team_id))}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-balance text-gray-900 dark:text-gray-100">
          What {abbrev}&apos;s side of the {formatDay(trade.date)} trade turned into
        </h2>
        <p className="mt-1 max-w-prose text-sm text-gray-600 dark:text-gray-300">
          Follows only players who stayed with {abbrev}. When one was traded on, the branch continues with what came back.
          Each stint counts only the games played for {abbrev}.
        </p>
        <p className="mt-2 text-sm text-gray-700 tabular-nums dark:text-gray-300">
          {tree.stints} player stints · {tree.games} games played for {abbrev}
          {tree.truncated.size > 0 && ' so far'}
        </p>
        {allFollowUps.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
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

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-300">
        <span><span className="mr-1.5 inline-block h-3 w-5 rounded border border-gray-400 align-[-2px]" />Stint on {abbrev}</span>
        <span><span className="mr-1.5 inline-block h-3 w-5 rounded border border-gray-400 bg-gray-100 align-[-2px] dark:bg-gray-700" />Trade</span>
        <span><span className="mr-1.5 inline-block h-3 w-5 rounded border border-dashed border-gray-400 align-[-2px]" />Released</span>
        <span><span className="mr-1.5 inline-block h-3 w-5 rounded border border-dotted border-gray-400 align-[-2px]" />Played elsewhere after release</span>
      </div>

      <div className="overflow-x-auto pb-1">
        {/* The trade being followed is the root; what came back hangs under it. */}
        <button
          type="button"
          onClick={() => onSelectTrade(trade.id)}
          className={`${NODE} border-gray-300 bg-gray-50 text-left hover:border-blue-400 dark:border-gray-600 dark:bg-gray-700`}
        >
          <span className="font-semibold text-gray-900 dark:text-gray-100">
            Trade with {teamAbbrev(teams, other?.team_id ?? 0)} · {formatDay(trade.date)}
          </span>
          <span className="text-xs text-gray-600 dark:text-gray-300">
            {abbrev} sent {sent.length ? sent.map(p => p.name).join(', ') : 'no players'}
            {tree.root.length ? '; got:' : ' and got no players back.'}
          </span>
        </button>
        {tree.root.length > 0 && (
          <div className="mt-1 pl-3 sm:pl-5">
            <Branch
              nodes={tree.root}
              teams={teams}
              teamId={follow}
              seasonOver={activity.season_over}
              truncated={tree.truncated}
              collapsed={collapsed}
              onToggle={toggle}
              onExpand={() => setDepth(d => d + INITIAL_DEPTH)}
              onSelectTrade={onSelectTrade}
            />
          </div>
        )}
      </div>
    </div>
  )
}

export default TradeTree

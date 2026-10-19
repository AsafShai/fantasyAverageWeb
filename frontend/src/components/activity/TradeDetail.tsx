import type { Trade } from '../../types/activity'
import PlayerNameLink from '../PlayerNameLink'
import { MyTeamMark } from '../MyTeamMark'
import {
  OPEN_SPOT_KEY,
  SMALL_SAMPLE_GAMES,
  categoryValue,
  countedLine,
  formatCategory,
  formatDay,
  isPctCategory,
  makesAttempts,
  missedGames,
  overridesForTrade,
  perGameSummary,
  resetTrade,
  setCounted,
  sideRows,
  stintLine,
  type SideRow,
  type StatLine,
  type StatMode,
  type TradeOverrides,
} from '../../utils/leagueActivity'
import { Pill, SIDE_BAR, SIDE_PANEL, SideDot, StatModeToggle } from './shared'
import { teamAbbrev, teamName, type TeamLookup } from './teams'

interface TradeDetailProps {
  trade: Trade
  trades: Trade[]
  teams: TeamLookup
  categories: string[]
  seasonOver: boolean
  mode: StatMode
  onModeChange: (m: StatMode) => void
  overrides: TradeOverrides
  onOverridesChange: (o: TradeOverrides) => void
  onSelectTrade: (id: string) => void
  onOpenTree: (tradeId: string, teamId: number) => void
}

function StintCaveats({ row }: { row: SideRow }) {
  const s = row.stint
  if (s.games_played < SMALL_SAMPLE_GAMES) {
    return <Pill tone="warn" title={`Fewer than ${SMALL_SAMPLE_GAMES} games on this roster`}>Small sample</Pill>
  }
  if (missedGames(s)) {
    return (
      <Pill tone="warn" title={`Played ${s.games_played} of his NBA team's ${s.team_games} games while on this roster`}>
        Missed games
      </Pill>
    )
  }
  return null
}

function ExitPill({ row, trades, teams, seasonOver, onSelectTrade }: {
  row: SideRow
  trades: Trade[]
  teams: TeamLookup
  seasonOver: boolean
  onSelectTrade: (id: string) => void
}) {
  const s = row.stint
  if (s.exit === 'traded' && s.exit_trade_id) {
    const onward = trades.find(t => t.id === s.exit_trade_id)
    return (
      <button
        type="button"
        onClick={() => onSelectTrade(s.exit_trade_id as string)}
        className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-800 hover:underline dark:bg-blue-950 dark:text-blue-300"
      >
        Traded on{onward ? ` · ${formatDay(onward.date)}` : ''}
      </button>
    )
  }
  if (s.exit === 'released') {
    return (
      <>
        <Pill>Released {formatDay(s.end)}</Pill>
        {s.picked_up_after && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            then picked up by <b>{teamAbbrev(teams, s.picked_up_after.team_id)}</b> {formatDay(s.picked_up_after.date)}
          </span>
        )}
      </>
    )
  }
  return <Pill tone="ok">{seasonOver ? 'On roster at season end' : 'Still on roster'}</Pill>
}

const TradeDetail = ({
  trade, trades, teams, categories, seasonOver, mode, onModeChange, overrides, onOverridesChange, onSelectTrade, onOpenTree,
}: TradeDetailProps) => {
  const sides = trade.sides.map(s => s.team_id)
  const rows = sides.map(teamId => sideRows(trade, teamId, overrides))
  const lines = rows.map(countedLine)
  const changes = overridesForTrade(overrides, trade.id)

  const toggle = (row: SideRow, counted: boolean) =>
    onOverridesChange(setCounted(overrides, trade.id, row.openSpot ? OPEN_SPOT_KEY : row.stint.player_id, counted))

  const cell = (line: StatLine, cat: string) => {
    const v = categoryValue(line, cat, mode)
    const ma = makesAttempts(line, cat)
    return (
      <>
        {formatCategory(v, cat, mode)}
        {ma && <span className="ml-1 hidden text-xs text-gray-400 sm:inline dark:text-gray-500">{ma}</span>}
      </>
    )
  }

  const shareBar = (a: number | null, b: number | null) => {
    const x = a ?? 0
    const y = b ?? 0
    const share = x + y > 0 ? (x / (x + y)) * 100 : 50
    return (
      <div className="flex h-3 gap-0.5 overflow-hidden rounded" title={`${Math.round(share)}% / ${Math.round(100 - share)}%`}>
        <span className={SIDE_BAR[0]} style={{ width: `${share}%` }} />
        <span className={SIDE_BAR[1]} style={{ width: `${100 - share}%` }} />
      </div>
    )
  }

  const gpCell = (line: StatLine) => line.gp

  return (
    <div className="min-w-0 space-y-4">
      <section className="space-y-4 rounded-lg bg-white p-4 shadow-md dark:bg-gray-800">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {teamAbbrev(teams, sides[0])} ⇄ {teamAbbrev(teams, sides[1])} · {formatDay(trade.date)}
          </h2>
          <div className="flex flex-wrap gap-2">
            {sides.map(teamId => (
              <button
                key={teamId}
                type="button"
                onClick={() => onOpenTree(trade.id, teamId)}
                className="rounded-md border border-gray-300 px-2.5 py-1 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                Tree for {teamAbbrev(teams, teamId)}
              </button>
            ))}
          </div>
        </div>

        {trade.released_for_trade.length > 0 && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Roster spot made by releasing {trade.released_for_trade.map(p => p.name).join(', ')} when the trade went through.
          </p>
        )}

        {changes > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <span>Your view: {changes} {changes === 1 ? 'change' : 'changes'} from the default. Only you see this.</span>
            <button
              type="button"
              onClick={() => onOverridesChange(resetTrade(overrides, trade.id))}
              className="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-sm dark:border-amber-800 dark:bg-gray-800"
            >
              Reset
            </button>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          {sides.map((teamId, i) => (
            <div key={teamId} className={`min-w-0 space-y-2 rounded-lg p-3 ${SIDE_PANEL[i]}`}>
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                <SideDot side={i as 0 | 1} />
                {teamName(teams, teamId)} received
                <MyTeamMark teamId={teamId} />
                <span className="block text-xs font-normal text-gray-600 dark:text-gray-300">
                  {rows[i].length ? `${lines[i].gp} games played for ${teamAbbrev(teams, teamId)}` : 'No players'}
                </span>
              </h3>
              {rows[i].map(row => {
                const s = row.stint
                const id = `count-${trade.id}-${row.openSpot ? OPEN_SPOT_KEY : s.player_id}`
                return (
                  <div
                    key={`${row.openSpot}-${s.player_id}`}
                    className={`space-y-1 rounded-md p-2.5 text-sm ${
                      row.openSpot ? 'border border-dashed border-gray-400 dark:border-gray-500' : 'bg-white dark:bg-gray-800'
                    } ${row.counted ? '' : 'opacity-60'}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold text-gray-900 dark:text-gray-100">
                        {row.openSpot && 'Open roster spot: '}
                        <PlayerNameLink name={s.name} playerId={s.player_id} className="-my-1 inline-block py-1 hover:underline" />
                      </span>
                      <label htmlFor={id} className="-m-1.5 flex shrink-0 cursor-pointer items-center gap-1.5 rounded p-1.5 text-xs text-gray-600 dark:text-gray-300">
                        <input
                          id={id}
                          type="checkbox"
                          checked={row.counted}
                          onChange={e => toggle(row, e.target.checked)}
                          className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 sm:h-4 sm:w-4 dark:border-gray-600"
                        />
                        Count
                      </label>
                    </div>
                    {row.openSpot && trade.open_roster_spot && (
                      <p className="text-xs text-gray-600 dark:text-gray-300">
                        {teamAbbrev(teams, teamId)} got one player fewer, then picked him up on{' '}
                        {formatDay(trade.open_roster_spot.added_on)} without dropping anyone. Not counted unless you tick it.
                      </p>
                    )}
                    <p className="text-xs text-gray-600 tabular-nums dark:text-gray-300">
                      {formatDay(s.start)} – {formatDay(s.end)} · <b>{s.games_played} GP</b> of {s.team_games} team games ·{' '}
                      {perGameSummary(s)}
                    </p>
                    {!row.openSpot && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StintCaveats row={row} />
                        <ExitPill row={row} trades={trades} teams={teams} seasonOver={seasonOver} onSelectTrade={onSelectTrade} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-lg bg-white p-4 shadow-md dark:bg-gray-800">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">What each side got</h3>
          <StatModeToggle mode={mode} onChange={onModeChange} />
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {mode === 'totals' ? 'Totals' : 'Per-game averages'} from the counted players while they were on the receiving roster.
          The bar splits each category between the two sides. FG% and FT% are made / attempted across those games.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs text-gray-500 uppercase dark:border-gray-700 dark:text-gray-400">
                <th className="px-2 py-1.5 text-left font-semibold">Cat</th>
                <th className="px-2 py-1.5 text-right font-semibold whitespace-nowrap"><SideDot side={0} />{teamAbbrev(teams, sides[0])}</th>
                <th className="w-2/5 min-w-[4rem] px-2 py-1.5 text-left font-semibold sm:min-w-[8rem]">Share</th>
                <th className="px-2 py-1.5 text-right font-semibold whitespace-nowrap"><SideDot side={1} />{teamAbbrev(teams, sides[1])}</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              <tr className="border-b border-gray-100 font-semibold dark:border-gray-700">
                <td className="px-2 py-1.5 text-gray-900 dark:text-gray-100">GP</td>
                <td className="px-2 py-1.5 text-right">{gpCell(lines[0])}</td>
                <td className="px-2 py-1.5">{shareBar(lines[0].gp, lines[1].gp)}</td>
                <td className="px-2 py-1.5 text-right">{gpCell(lines[1])}</td>
              </tr>
              {categories.map(cat => (
                <tr key={cat} className="border-b border-gray-100 dark:border-gray-700">
                  <td className="px-2 py-1.5 text-gray-900 dark:text-gray-100">{cat}</td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">{cell(lines[0], cat)}</td>
                  <td className="px-2 py-1.5">
                    {isPctCategory(cat) ? (
                      <span className="text-xs text-gray-400 dark:text-gray-500">%</span>
                    ) : (
                      shareBar(categoryValue(lines[0], cat, mode), categoryValue(lines[1], cat, mode))
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">{cell(lines[1], cat)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="pt-2 font-semibold text-gray-900 dark:text-gray-100">By player</h3>
        <ul className="space-y-2 sm:hidden">
          {rows.flatMap((sideRowsForTeam, i) =>
            sideRowsForTeam.map(row => (
              <li
                key={`${i}-${row.openSpot}-${row.stint.player_id}`}
                className={`rounded-md border border-gray-200 p-2.5 text-sm dark:border-gray-700 ${row.counted ? '' : 'text-gray-400 italic dark:text-gray-500'}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">
                    <SideDot side={i as 0 | 1} />
                    {row.stint.name}
                    {row.openSpot && <span className="ml-1 text-xs font-normal text-gray-400">open spot</span>}
                    {!row.counted && <span className="ml-1 text-xs font-normal">not counted</span>}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums">{row.stint.games_played} GP</span>
                </div>
                <dl className="mt-1.5 grid grid-cols-4 gap-x-2 gap-y-1 text-xs tabular-nums">
                  {categories.map(cat => (
                    <div key={cat} className="flex justify-between gap-1">
                      <dt className="text-gray-500 dark:text-gray-400">{cat}</dt>
                      <dd>{formatCategory(categoryValue(stintLine(row.stint), cat, mode), cat, mode)}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            )),
          )}
        </ul>
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs text-gray-500 uppercase dark:border-gray-700 dark:text-gray-400">
                <th className="px-2 py-1.5 text-left font-semibold">Player</th>
                <th className="px-2 py-1.5 text-right font-semibold">GP</th>
                {categories.map(cat => (
                  <th key={cat} className="px-2 py-1.5 text-right font-semibold">{cat}</th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {rows.flatMap((sideRowsForTeam, i) =>
                sideRowsForTeam.map(row => (
                  <tr
                    key={`${i}-${row.openSpot}-${row.stint.player_id}`}
                    className={`border-b border-gray-100 dark:border-gray-700 ${row.counted ? '' : 'text-gray-400 italic dark:text-gray-500'}`}
                  >
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      <SideDot side={i as 0 | 1} />
                      {row.stint.name}
                      {row.openSpot && <span className="ml-1 text-xs text-gray-400">open spot</span>}
                      {!row.counted && <span className="ml-1 text-xs">not counted</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right font-semibold">{row.stint.games_played}</td>
                    {categories.map(cat => (
                      <td key={cat} className="px-2 py-1.5 text-right">
                        {formatCategory(categoryValue(stintLine(row.stint), cat, mode), cat, mode)}
                      </td>
                    ))}
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

export default TradeDetail

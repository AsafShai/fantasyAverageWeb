import { FoldTitle } from './FoldTitle'
import { useSectionOpen } from '../hooks/useSectionOpen'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useGetNbaPlayerGamesQuery } from '../store/api/fantasyApi'
import type { PlayerGameLogGame } from '../types/api'
import { ZValue, FantasyTeamTag } from './boxScores/BoxScorePanel'
import {
  COUNT_COLS,
  GAME_LOG_SORT_DEFAULT,
  SHOT_COLS,
  averageZ,
  logDate,
  mean,
  meanUsage,
  record,
  shotLine,
  shotPct,
  signed,
  sortGameLog,
  toggleGameLogSort,
  usageText,
  whole,
  zByGame,
  type GameLogSort,
  type GameLogSortKey,
} from '../utils/playerGameLog'
import LoadingSpinner from './LoadingSpinner'
import ErrorMessage from './ErrorMessage'
import { getErrorMessage } from '../utils/errorMessage'

function GameZ({ z }: { z: number | undefined }) {
  if (z == null) return <span className="text-gray-400">—</span>
  return <ZValue z={z} />
}

function Result({ game }: { game: PlayerGameLogGame }) {
  if (game.team_pts == null || game.opp_pts == null) {
    return <span className="text-gray-400">—</span>
  }
  const win = game.team_pts > game.opp_pts
  const loss = game.team_pts < game.opp_pts
  const mark = win ? 'W' : loss ? 'L' : 'T'
  const color = win
    ? 'text-green-700 dark:text-green-400'
    : loss
      ? 'text-red-600 dark:text-red-400'
      : 'text-gray-500 dark:text-gray-400'
  return (
    <span className="whitespace-nowrap text-[11px]">
      <span className={`font-semibold ${color}`}>{mark}</span>
      <span className="ml-1 tabular-nums text-gray-500 dark:text-gray-400">
        {game.team_pts}–{game.opp_pts}
      </span>
    </span>
  )
}

const cell = 'px-2 py-2 text-center tabular-nums whitespace-nowrap text-gray-800 dark:text-gray-100'
const head = 'px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400'
const stickyBody = 'sticky z-10 bg-white group-hover:bg-gray-50 dark:bg-gray-900 dark:group-hover:bg-gray-800'
const stickyHead = 'sticky z-40 bg-gray-50 dark:bg-gray-800'
const stickyAvg = 'sticky z-30 bg-gray-100 dark:bg-gray-800'
const pinnedEdge = 'shadow-[4px_0_6px_-4px_rgba(0,0,0,0.45)]'

function SortHead({
  label,
  column,
  sort,
  onSort,
  className,
  title,
  align = 'center',
}: {
  label: string
  column: GameLogSortKey
  sort: GameLogSort
  onSort: (column: GameLogSortKey) => void
  className: string
  title?: string
  align?: 'left' | 'center'
}) {
  const active = sort.key === column
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={className}
      title={title}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`inline-flex items-center gap-0.5 bg-transparent p-0 font-semibold uppercase tracking-wider text-inherit hover:text-gray-800 dark:hover:text-gray-100 ${
          align === 'left' ? '' : 'w-full justify-center'
        }`}
      >
        {label}
        {active ? <span aria-hidden="true">{sort.dir === 'asc' ? '▲' : '▼'}</span> : null}
      </button>
    </th>
  )
}

export default function PlayerGameLog({ playerId }: { playerId: string }) {
  const [open, toggle] = useSectionOpen('game-log')
  const { data, error, isLoading } = useGetNbaPlayerGamesQuery(playerId, { skip: !playerId })
  const shown = useMemo(
    () => (data?.games ?? []).filter((game) => game.season === data?.current_season),
    [data],
  )
  const zs = useMemo(() => zByGame(data), [data])
  const avgZ = averageZ(shown, zs)
  const [sort, setSort] = useState<GameLogSort>(GAME_LOG_SORT_DEFAULT)
  const ordered = useMemo(() => sortGameLog(shown, zs, sort), [shown, zs, sort])
  const onSort = (column: GameLogSortKey) => setSort((current) => toggleGameLogSort(current, column))
  const statHeads: { key: GameLogSortKey; label: string; title?: string }[] = [
    ...COUNT_COLS.slice(0, 1).map((col) => ({ key: col.key, label: col.label })),
    { key: 'usg', label: 'USG%', title: "Share of the team's possessions used while he was on the floor" },
    ...COUNT_COLS.slice(1, 6).map((col) => ({ key: col.key, label: col.label })),
    ...SHOT_COLS.map((col) => ({ key: col.label, label: col.label })),
    ...COUNT_COLS.slice(6).map((col) => ({ key: col.key, label: col.label })),
  ]

  return (
    <section className="mt-6 bg-white dark:bg-gray-900 rounded-lg shadow border border-gray-200 dark:border-gray-700 p-4 sm:p-6">
      <div className={open ? 'mb-4' : ''}>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          <FoldTitle open={open} onToggle={toggle}>Game log</FoldTitle>
        </h2>
        {data && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {data.current_season}
            {' · '}
            {shown.length} {shown.length === 1 ? 'game' : 'games'}
          </p>
        )}
      </div>

      {!open ? null : isLoading ? (
        <div className="py-10">
          <LoadingSpinner />
        </div>
      ) : error ? (
        <ErrorMessage message={getErrorMessage(error, 'Failed to load game log')} />
      ) : shown.length === 0 ? (
        <p className="py-12 text-center text-sm text-gray-400">No games in the log yet.</p>
      ) : (
        <div className="overflow-auto max-h-[32rem] rounded-md border border-gray-200 dark:border-gray-700">
          <table className="min-w-full text-sm border-separate border-spacing-0">
            <caption className="sr-only">Game log. Column headers sort the games. Opponent opens the box score.</caption>
            <thead>
              <tr>
                <SortHead label="Date" column="date" sort={sort} onSort={onSort} align="left" className={`${head} ${stickyHead} left-0 top-0 text-left min-w-[4.75rem]`} />
                <SortHead label="Opp" column="opp" sort={sort} onSort={onSort} align="left" className={`${head} ${stickyHead} ${pinnedEdge} left-[4.75rem] top-0 text-left min-w-[7.25rem]`} />
                <SortHead label="Z" column="z" sort={sort} onSort={onSort} title="Z-score for this night, same as the box score" className={`${head} sticky top-0 z-20 bg-gray-50 dark:bg-gray-800`} />
                {statHeads.map((col) => (
                  <SortHead key={col.label} label={col.label} column={col.key} sort={sort} onSort={onSort} title={col.title} className={`${head} sticky top-0 z-20 bg-gray-50 dark:bg-gray-800`} />
                ))}
                <SortHead label="Fantasy" column="team" sort={sort} onSort={onSort} title="Fantasy team that rostered him on the night of the game" className={`${head} sticky top-0 z-20 bg-gray-50 dark:bg-gray-800`} />
              </tr>
              <tr>
                <th className={`${head} ${stickyAvg} left-0 top-[33px] text-left normal-case tracking-normal text-gray-700 dark:text-gray-200`}>Avg</th>
                <th className={`${head} ${stickyAvg} ${pinnedEdge} left-[4.75rem] top-[33px] text-left normal-case tracking-normal tabular-nums text-gray-700 dark:text-gray-200 min-w-[7.25rem]`} title="Wins–losses">
                  {record(shown)}
                </th>
                <th className={`${head} sticky top-[33px] z-20 bg-gray-100 dark:bg-gray-800/95 normal-case tracking-normal`}>
                  {avgZ == null ? '—' : <ZValue z={avgZ} />}
                </th>
                {COUNT_COLS.slice(0, 1).map((col) => (
                  <th key={col.label} className={`${head} sticky top-[33px] z-20 bg-gray-100 dark:bg-gray-800/95 normal-case tracking-normal text-gray-700 dark:text-gray-200`}>
                    {mean(shown, col.key)}
                  </th>
                ))}
                <th className={`${head} sticky top-[33px] z-20 bg-gray-100 dark:bg-gray-800/95 normal-case tracking-normal text-gray-700 dark:text-gray-200`}>
                  {meanUsage(shown)}
                </th>
                {COUNT_COLS.slice(1, 6).map((col) => (
                  <th key={col.label} className={`${head} sticky top-[33px] z-20 bg-gray-100 dark:bg-gray-800/95 normal-case tracking-normal text-gray-700 dark:text-gray-200`}>
                    {mean(shown, col.key)}
                  </th>
                ))}
                {SHOT_COLS.map((col) => (
                  <th key={col.label} className={`${head} sticky top-[33px] z-20 bg-gray-100 dark:bg-gray-800/95 normal-case tracking-normal text-gray-700 dark:text-gray-200`}>
                    {shotPct(
                      shown.reduce((sum, game) => sum + game[col.made], 0),
                      shown.reduce((sum, game) => sum + game[col.att], 0),
                    )}
                  </th>
                ))}
                {COUNT_COLS.slice(6).map((col) => (
                  <th key={col.label} className={`${head} sticky top-[33px] z-20 bg-gray-100 dark:bg-gray-800/95 normal-case tracking-normal text-gray-700 dark:text-gray-200`}>
                    {mean(shown, col.key)}
                  </th>
                ))}
                <th className={`${head} sticky top-[33px] z-20 bg-gray-100 dark:bg-gray-800/95 normal-case tracking-normal text-gray-400`}>—</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((game) => {
                const date = logDate(game.game_date)
                return (
                  <tr key={game.game_id} className="group">
                    <td className={`${stickyBody} left-0 border-t border-gray-100 dark:border-gray-800 px-2 py-1.5 min-w-[4.75rem]`}>
                      <time dateTime={game.game_date} className="block leading-tight">
                        <span className="block text-[10px] uppercase tracking-wide text-gray-400">{date.weekday}</span>
                        <span className="text-gray-700 dark:text-gray-200">{date.day}</span>
                      </time>
                    </td>
                    <td className={`${stickyBody} ${pinnedEdge} left-[4.75rem] border-t border-gray-100 dark:border-gray-800 px-2 py-1.5 min-w-[7.25rem]`}>
                      <Link
                        to={`/box-scores?date=${game.game_date}&game=${game.game_id}`}
                        state={{ from: `/player/${playerId}` }}
                        className="flex flex-col items-start leading-tight text-blue-700 dark:text-blue-300 hover:underline"
                        title="Box score"
                      >
                        <span className="whitespace-nowrap">
                          <span className="text-gray-400 font-normal">{game.is_home ? 'vs' : '@'}</span>{' '}
                          {game.opponent}
                        </span>
                        <Result game={game} />
                      </Link>
                    </td>
                    <td className={`${cell} border-t border-gray-100 dark:border-gray-800`}>
                      <GameZ z={zs.get(game.game_id)} />
                    </td>
                    {COUNT_COLS.slice(0, 1).map((col) => (
                      <td key={col.label} className={`${cell} border-t border-gray-100 dark:border-gray-800 ${col.strong ? 'font-semibold text-gray-900 dark:text-white' : ''}`}>
                        {whole(game[col.key])}
                      </td>
                    ))}
                    <td className={`${cell} border-t border-gray-100 dark:border-gray-800`}>
                      {usageText(game.usg)}
                    </td>
                    {COUNT_COLS.slice(1, 6).map((col) => (
                      <td key={col.label} className={`${cell} border-t border-gray-100 dark:border-gray-800 ${col.strong ? 'font-semibold text-gray-900 dark:text-white' : ''}`}>
                        {whole(game[col.key])}
                      </td>
                    ))}
                    {SHOT_COLS.map((col) => (
                      <td key={col.label} className={`${cell} border-t border-gray-100 dark:border-gray-800`} title={shotPct(game[col.made], game[col.att])}>
                        {shotLine(game[col.made], game[col.att])}
                      </td>
                    ))}
                    {COUNT_COLS.slice(6).map((col) => (
                      <td
                        key={col.label}
                        className={`${cell} border-t border-gray-100 dark:border-gray-800 ${
                          col.signed
                            ? game[col.key] > 0
                              ? 'text-green-700 dark:text-green-400'
                              : game[col.key] < 0
                                ? 'text-red-600 dark:text-red-400'
                                : ''
                            : ''
                        }`}
                      >
                        {col.signed ? signed(game[col.key]) : whole(game[col.key])}
                      </td>
                    ))}
                    <td className={`${cell} border-t border-gray-100 dark:border-gray-800 text-left`}>
                      <FantasyTeamTag value={game.fantasy ?? undefined} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

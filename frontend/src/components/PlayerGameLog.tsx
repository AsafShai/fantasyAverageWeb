import { useMemo } from 'react'
import { Link } from 'react-router'
import { useGetNbaPlayerGamesQuery } from '../store/api/fantasyApi'
import type { PlayerGameLogGame } from '../types/api'
import LoadingSpinner from './LoadingSpinner'
import ErrorMessage from './ErrorMessage'
import { getErrorMessage } from '../utils/errorMessage'

const COUNT_COLS: { key: 'minutes' | 'pts' | 'reb' | 'ast' | 'stl' | 'blk' | 'tov' | 'plus_minus'; label: string; strong?: boolean; signed?: boolean }[] = [
  { key: 'minutes', label: 'MIN' },
  { key: 'pts', label: 'PTS', strong: true },
  { key: 'reb', label: 'REB' },
  { key: 'ast', label: 'AST' },
  { key: 'stl', label: 'STL' },
  { key: 'blk', label: 'BLK' },
  { key: 'tov', label: 'TO' },
  { key: 'plus_minus', label: '+/−', signed: true },
]

const SHOT_COLS: { made: 'fgm' | 'fg3m' | 'ftm'; att: 'fga' | 'fg3a' | 'fta'; label: string }[] = [
  { made: 'fgm', att: 'fga', label: 'FG' },
  { made: 'fg3m', att: 'fg3a', label: '3P' },
  { made: 'ftm', att: 'fta', label: 'FT' },
]

function whole(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

function signed(n: number): string {
  const text = whole(n)
  return n > 0 ? `+${text}` : text
}

function shotLine(made: number, att: number): string {
  return `${whole(made)}-${whole(att)}`
}

function shotPct(made: number, att: number): string {
  if (att <= 0) return '—'
  return `${((made / att) * 100).toFixed(1)}%`
}

function mean(games: PlayerGameLogGame[], key: (typeof COUNT_COLS)[number]['key']): string {
  if (games.length === 0) return '—'
  const value = games.reduce((sum, game) => sum + game[key], 0) / games.length
  return key === 'plus_minus' ? signed(Number(value.toFixed(1))) : value.toFixed(1)
}

function record(games: PlayerGameLogGame[]): string {
  let wins = 0
  let losses = 0
  for (const game of games) {
    if (game.team_pts == null || game.opp_pts == null || game.team_pts === game.opp_pts) continue
    if (game.team_pts > game.opp_pts) wins += 1
    else losses += 1
  }
  if (wins + losses === 0) return '—'
  return `${wins}–${losses}`
}

function logDate(iso: string): { weekday: string; day: string } {
  const date = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(date.getTime())) return { weekday: '', day: iso }
  return {
    weekday: date.toLocaleDateString(undefined, { weekday: 'short' }),
    day: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
  }
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

export default function PlayerGameLog({ playerId }: { playerId: string }) {
  const { data, error, isLoading } = useGetNbaPlayerGamesQuery(playerId, { skip: !playerId })
  const shown = useMemo(
    () => (data?.games ?? []).filter((game) => game.season === data?.current_season),
    [data],
  )

  return (
    <section className="mt-6 bg-white dark:bg-gray-900 rounded-lg shadow border border-gray-200 dark:border-gray-700 p-4 sm:p-6">
      <div className="mb-4">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Game log</h2>
        {data && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {data.current_season}
            {' · '}
            {shown.length} {shown.length === 1 ? 'game' : 'games'}
          </p>
        )}
      </div>

      {isLoading ? (
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
            <caption className="sr-only">Game log, newest first. Opponent opens the box score.</caption>
            <thead>
              <tr>
                <th className={`${head} ${stickyHead} left-0 top-0 text-left min-w-[4.75rem]`}>Date</th>
                <th className={`${head} ${stickyHead} ${pinnedEdge} left-[4.75rem] top-0 text-left min-w-[7.25rem]`}>Opp</th>
                {COUNT_COLS.slice(0, 6).map((col) => (
                  <th key={col.label} className={`${head} sticky top-0 z-20 bg-gray-50 dark:bg-gray-800`}>{col.label}</th>
                ))}
                {SHOT_COLS.map((col) => (
                  <th key={col.label} className={`${head} sticky top-0 z-20 bg-gray-50 dark:bg-gray-800`}>{col.label}</th>
                ))}
                {COUNT_COLS.slice(6).map((col) => (
                  <th key={col.label} className={`${head} sticky top-0 z-20 bg-gray-50 dark:bg-gray-800`}>{col.label}</th>
                ))}
              </tr>
              <tr>
                <th className={`${head} ${stickyAvg} left-0 top-[33px] text-left normal-case tracking-normal text-gray-700 dark:text-gray-200`}>Avg</th>
                <th className={`${head} ${stickyAvg} ${pinnedEdge} left-[4.75rem] top-[33px] text-left normal-case tracking-normal tabular-nums text-gray-700 dark:text-gray-200 min-w-[7.25rem]`} title="Wins–losses">
                  {record(shown)}
                </th>
                {COUNT_COLS.slice(0, 6).map((col) => (
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
              </tr>
            </thead>
            <tbody>
              {shown.map((game) => {
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
                    {COUNT_COLS.slice(0, 6).map((col) => (
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

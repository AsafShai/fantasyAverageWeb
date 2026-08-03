import { useGetMinigameLeaderboardQuery } from '../../store/api/fantasyApi'
import type { GameSlug } from '../../minigames/types'
import { HINTS_GAMES } from '../../minigames/types'

const PODIUM: Record<number, string> = {
  1: 'bg-amber-50 dark:bg-amber-900/20',
  2: 'bg-gray-100 dark:bg-gray-700/40',
  3: 'bg-orange-50 dark:bg-orange-900/20',
}

export default function LeaderboardCard({
  gameSlug,
  description,
}: {
  gameSlug: GameSlug
  description: string
}) {
  const { data, isLoading } = useGetMinigameLeaderboardQuery(gameSlug)
  const showHints = HINTS_GAMES.includes(gameSlug)
  const rows = data?.rows ?? []

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Leaderboard</h3>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{description}</p>
      {isLoading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-400">No streaks yet — be the first to play.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-gray-500 dark:text-gray-400">
              <th className="py-1 pr-2">#</th>
              <th className="py-1 pr-2">Player</th>
              <th className="py-1 pr-2 text-right">Best</th>
              {showHints && <th className="py-1 text-right">Hints</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={`${r.rank}-${r.displayName}-${r.bestStreak}`}
                className={`${PODIUM[r.rank] ?? ''} border-t border-gray-100 dark:border-gray-800`}
              >
                <td className="py-1.5 pr-2 font-mono text-gray-500">{r.rank}</td>
                <td className="py-1.5 pr-2 font-medium text-gray-900 dark:text-gray-100">
                  {r.displayName}
                </td>
                <td className="py-1.5 pr-2 text-right font-semibold text-blue-600 dark:text-blue-400">
                  {r.bestStreak}
                </td>
                {showHints && (
                  <td className="py-1.5 text-right text-gray-600 dark:text-gray-300">
                    {r.hintsUsed ?? '—'}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

import { useGetMinigameLeaderboardQuery } from '../../store/api/fantasyApi'
import { HINTS_GAMES, type GameSlug } from '../../minigames/types'
import { Card } from '../ui'

/** Phone version of LeaderboardCard: same query, columns, podium tints and empty/loading text. */
export default function MobileLeaderboard({ gameSlug, description }: { gameSlug: GameSlug; description: string }) {
  const { data, isLoading } = useGetMinigameLeaderboardQuery(gameSlug)
  const showHints = HINTS_GAMES.includes(gameSlug)
  const rows = data?.rows ?? []

  return (
    <Card title="Leaderboard" className="mr-mg-lb">
      <span className="mr-meta" style={{ marginTop: -6 }}>{description}</span>
      {isLoading ? (
        <p className="mr-meta">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mr-meta">No streaks yet — be the first to play.</p>
      ) : (
        <div className="mr-tw">
          <table className="mr-t">
            <thead>
              <tr>
                <th className="mr-l" scope="col">#</th>
                <th className="mr-l" scope="col">Player</th>
                <th scope="col">Best</th>
                {showHints && <th scope="col">Hints</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.rank}-${r.displayName}-${r.bestStreak}`} className={r.rank <= 3 ? `mr-p${r.rank}` : undefined}>
                  <td className="mr-l mr-mg-rank">{r.rank}</td>
                  <td className="mr-l" style={{ whiteSpace: 'normal', fontWeight: 600 }}>{r.displayName}</td>
                  <td className="mr-mg-best">{r.bestStreak}</td>
                  {showHints && <td>{r.hintsUsed ?? '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

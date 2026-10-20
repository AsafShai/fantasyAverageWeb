import { Link } from 'react-router'
import { useGetLatestMovesQuery } from '../../store/api/fantasyApi'
import { formatDay, localDay } from '../../utils/leagueActivity'
import MoveRow from './MoveRow'
import { teamLookup } from './teams'

const LATEST_MOVES = 8

/** Today card: the league's most recent adds, drops and trades. */
const LatestMovesCard = () => {
  const { data, isLoading, isError } = useGetLatestMovesQuery(LATEST_MOVES)
  const teams = teamLookup(data?.teams ?? [])

  return (
    <section className="rounded-lg bg-white shadow-md dark:bg-gray-800">
      <div className="flex items-baseline justify-between gap-2 px-4 pt-3 pb-2">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Latest moves</h2>
        <Link to="/activity" className="-my-1 inline-block py-1 text-sm text-blue-700 hover:underline dark:text-blue-300">
          All activity →
        </Link>
      </div>
      {isLoading ? (
        <p className="px-4 pb-4 text-sm text-gray-500 dark:text-gray-400">Loading moves…</p>
      ) : isError ? (
        <p className="px-4 pb-4 text-sm text-gray-500 dark:text-gray-400">League activity is unavailable right now.</p>
      ) : !data?.moves.length ? (
        <p className="px-4 pb-4 text-sm text-gray-500 dark:text-gray-400">No adds, drops or trades yet this season.</p>
      ) : (
        <ul>
          {data.moves.map(m => (
            <MoveRow key={m.id} move={m} teams={teams} when={formatDay(localDay(m.at))} compact />
          ))}
        </ul>
      )}
    </section>
  )
}

export default LatestMovesCard

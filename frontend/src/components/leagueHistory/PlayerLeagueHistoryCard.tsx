import { useGetPlayerLeagueHistoryQuery } from '../../store/api/fantasyApi'
import { useSectionOpen } from '../../hooks/useSectionOpen'
import { FoldTitle } from '../FoldTitle'
import LoadingSpinner from '../LoadingSpinner'
import LeagueHistoryView from './LeagueHistoryView'

/** Desktop player page: who drafted, added, dropped and traded him this season.
 *  Folded by default; the moves load the first time it is opened. */
const PlayerLeagueHistoryCard = ({ playerId }: { playerId: string }) => {
  const [open, toggle] = useSectionOpen('league-history', false)
  const { data, isLoading, isError } = useGetPlayerLeagueHistoryQuery(playerId, { skip: !playerId || !open })
  return (
    <section
      aria-label="League history"
      className="bg-white dark:bg-gray-900 rounded-lg shadow border border-gray-200 dark:border-gray-700 p-6 mt-6"
    >
      <h2 className={`text-2xl font-bold text-gray-900 dark:text-gray-100 ${open ? 'mb-4' : ''}`}>
        <FoldTitle open={open} onToggle={toggle}>
          League History <span className="text-base font-normal text-gray-500 dark:text-gray-400">· this season</span>
        </FoldTitle>
      </h2>
      {!open ? null : isLoading ? (
        <div className="py-8"><LoadingSpinner /></div>
      ) : isError || !data ? (
        <p className="py-6 text-center text-gray-400 text-sm">Couldn't load this player's moves from ESPN.</p>
      ) : (
        <LeagueHistoryView history={data} />
      )}
    </section>
  )
}

export default PlayerLeagueHistoryCard

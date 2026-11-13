import { useGetNbaPlayerSeasonsQuery } from '../store/api/fantasyApi'
import { PAST_SEASON_COLS } from '../utils/pastSeasons'
import LoadingSpinner from './LoadingSpinner'

/** Per-game averages for the player's last few completed seasons (ESPN). */
const PlayerPastSeasonsCard = ({ playerId }: { playerId: string }) => {
  const { data, isLoading, isError } = useGetNbaPlayerSeasonsQuery(playerId, { skip: !playerId })
  const seasons = data?.seasons ?? []

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg shadow border border-gray-200 dark:border-gray-700 p-6 mt-6">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">
        Previous Seasons <span className="text-base font-normal text-gray-500 dark:text-gray-400">· per game</span>
      </h2>
      {isLoading ? (
        <div className="py-8"><LoadingSpinner /></div>
      ) : isError ? (
        <p className="py-6 text-center text-gray-400 text-sm">Couldn't load previous seasons from ESPN.</p>
      ) : seasons.length === 0 ? (
        <p className="py-6 text-center text-gray-400 text-sm">No previous NBA seasons.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Season</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Team</th>
                {PAST_SEASON_COLS.map((c) => (
                  <th key={c.key} className="px-3 py-2 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800">
              {seasons.map((s) => (
                <tr key={s.season}>
                  <td className="px-3 py-2.5 font-semibold text-gray-900 dark:text-gray-100 whitespace-nowrap">{s.season_label}</td>
                  <td className="px-3 py-2.5 text-gray-600 dark:text-gray-300 whitespace-nowrap">{s.teams.join(' / ') || '—'}</td>
                  {PAST_SEASON_COLS.map((c) => (
                    <td key={c.key} className="px-3 py-2.5 text-center text-gray-900 dark:text-gray-100 whitespace-nowrap">
                      {c.value(s)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default PlayerPastSeasonsCard

import type { DidNotPlay } from '../../types/api'
import PlayerNameLink from '../PlayerNameLink'
import { formatShortDate } from '../../utils/modelAccuracy'

/** Projected players who sat out — kept apart from the misses because sitting
 *  is an availability problem, not a projection one. */
const DidNotPlayList = ({ rows, total }: { rows: DidNotPlay[]; total: number }) => (
  <div>
    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1.5">
      Projected but didn't play <span className="font-normal text-gray-500 dark:text-gray-400">({total} this week, most projected minutes first)</span>
    </h3>
    <ul className="grid gap-x-6 grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] text-sm">
      {rows.map(r => (
        <li key={`${r.player_id}-${r.game_date}`} className="flex items-baseline justify-between gap-2 py-1.5 border-b border-gray-100 dark:border-gray-700/60">
          <span className="min-w-0">
            <PlayerNameLink name={r.player_name} playerId={r.player_id} className="text-gray-900 dark:text-gray-100 hover:underline" />
            <span className="text-xs text-gray-500 dark:text-gray-400"> {r.team} {r.is_home ? 'vs' : '@'} {r.opponent} · {formatShortDate(r.game_date)}</span>
          </span>
          <span className="shrink-0 text-xs tabular-nums text-gray-600 dark:text-gray-300">
            {Math.round(r.proj_min)} min{r.injury_status ? ` · ${r.injury_status}` : ''}
          </span>
        </li>
      ))}
    </ul>
  </div>
)

export default DidNotPlayList

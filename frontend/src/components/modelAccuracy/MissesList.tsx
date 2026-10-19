import type { ProjectionMiss } from '../../types/api'
import PlayerNameLink from '../PlayerNameLink'
import { formatShortDate, formatSigned } from '../../utils/modelAccuracy'

const MissesList = ({ misses }: { misses: ProjectionMiss[] }) => (
  <div className="grid gap-2.5 grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))]">
    {misses.map(m => {
      const up = m.z > 0
      return (
        <div key={`${m.player_id}-${m.game_date}`} className="min-w-0 grid gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 p-3">
          <div className="flex items-start justify-between gap-2">
            <span className="min-w-0">
              <PlayerNameLink name={m.player_name} playerId={m.player_id} className="font-semibold text-gray-900 dark:text-gray-100 hover:underline" />
              <span className="block text-xs text-gray-500 dark:text-gray-400">
                {m.team} {m.is_home ? 'vs' : '@'} {m.opponent} · {formatShortDate(m.game_date)}
              </span>
            </span>
            <span
              className={`shrink-0 text-[11px] font-semibold rounded px-1.5 py-0.5 ${
                up ? 'text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/40' : 'text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/40'
              }`}
            >
              {up ? '▲' : '▼'} {formatSigned(m.z)}σ
            </span>
          </div>
          <div className="text-sm tabular-nums text-gray-600 dark:text-gray-300">
            {m.line.map(s => `${s.stat} ${s.proj.toFixed(s.stat === 'MIN' ? 0 : 1)} → ${Math.round(s.actual)}`).join(' · ')}
          </div>
          <span className="inline-flex flex-wrap items-center gap-x-1.5 w-fit max-w-full text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1">
            <b className="font-semibold text-gray-900 dark:text-gray-100">{m.reason}</b>
            <span className="text-gray-600 dark:text-gray-300">{m.reason_detail}</span>
          </span>
        </div>
      )
    })}
  </div>
)

export default MissesList

import { useGetPlayerModelAccuracyQuery } from '../../store/api/fantasyApi'
import GameStrip from './GameStrip'
import FlagBadge from './FlagBadge'
import { formatSigned } from '../../utils/modelAccuracy'

/** PlayerProfile module: the last graded pre-game projections for one player.
 *  Renders nothing until the player has any (404 from the API). */
const PlayerAccuracyCard = ({ playerId }: { playerId: number }) => {
  const { data } = useGetPlayerModelAccuracyQuery(playerId, { skip: !playerId })
  if (!data) return null

  const n = data.games.length
  const dMin = data.actual_min - data.proj_min
  const verdict =
    data.flag === 'up' ? `Beating projections in ${data.beat_count} of the last ${n}.`
    : data.flag === 'down' ? `Trailing projections in ${n - data.beat_count} of the last ${n}.`
    : `Close to projections: beat ${data.beat_count} of the last ${n}.`

  return (
    <div className="mt-4 bg-white dark:bg-gray-900 rounded-lg shadow border border-gray-200 dark:border-gray-700 px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="inline-flex items-center text-[9px] font-bold uppercase tracking-wide text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/40 border border-blue-300 dark:border-blue-800 rounded px-1.5 py-0.5">
          Model vs. Reality
        </span>
        <span className="text-xs text-gray-600 dark:text-gray-300">Last {n} games · pre-game projections</span>
        <span className="ml-auto"><FlagBadge flag={data.flag} /></span>
      </div>
      <p className="text-sm text-gray-700 dark:text-gray-200 mb-3">
        {verdict}{' '}
        {Math.abs(dMin) >= 2 && (
          <>Minutes: <b className="tabular-nums">{data.actual_min.toFixed(1)} played vs {data.proj_min.toFixed(1)} projected</b>.</>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <div className="overflow-x-auto max-w-full">
          <table className="text-xs">
            <thead>
              <tr className="text-gray-500 dark:text-gray-400">
                <th className="pr-2 pb-1"></th>
                {data.categories.map(c => <th key={c.key} className="px-1 sm:px-1.5 pb-1 font-medium text-right">{c.label}</th>)}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              <tr>
                <td className="pr-1.5 sm:pr-2 text-gray-500 dark:text-gray-400">Proj</td>
                {data.categories.map(c => <td key={c.key} className="px-1 sm:px-1.5 py-0.5 text-right">{c.proj.toFixed(1)}</td>)}
              </tr>
              <tr>
                <td className="pr-1.5 sm:pr-2 text-gray-500 dark:text-gray-400">Actual</td>
                {data.categories.map(c => <td key={c.key} className="px-1 sm:px-1.5 py-0.5 text-right font-semibold">{c.actual == null ? '—' : c.actual.toFixed(1)}</td>)}
              </tr>
              <tr>
                <td className="pr-1.5 sm:pr-2 text-gray-500 dark:text-gray-400">Diff</td>
                {data.categories.map(c => {
                  const d = c.actual == null ? null : c.actual - c.proj
                  const tone = d == null || Math.abs(d) < 0.15 ? 'text-gray-500 dark:text-gray-400' : d > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
                  return <td key={c.key} className={`px-1 sm:px-1.5 py-0.5 text-right ${tone}`}>{d == null ? '—' : formatSigned(d)}</td>
                })}
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">Per game vs projection</div>
          <GameStrip games={data.games} />
        </div>
      </div>
    </div>
  )
}

export default PlayerAccuracyCard

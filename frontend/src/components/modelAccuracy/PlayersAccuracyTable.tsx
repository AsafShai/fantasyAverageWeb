import type { PlayerAccuracyRow } from '../../types/api'
import PlayerNameLink from '../PlayerNameLink'
import GameStrip from './GameStrip'
import FlagBadge from './FlagBadge'
import { formatSigned } from '../../utils/modelAccuracy'

const PlayersAccuracyTable = ({ rows }: { rows: PlayerAccuracyRow[] }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead>
        <tr className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
          <th className="text-left font-medium px-2 py-1.5">Player</th>
          <th className="text-left font-medium px-2 py-1.5 whitespace-nowrap">Last games</th>
          <th className="text-right font-medium px-2 py-1.5 whitespace-nowrap">PTS proj → actual</th>
          <th className="text-right font-medium px-2 py-1.5 whitespace-nowrap">MIN proj → actual</th>
          <th className="text-left font-medium px-2 py-1.5">Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(p => {
          const dPts = p.actual_pts - p.proj_pts
          const dMin = p.actual_min - p.proj_min
          return (
            <tr key={p.player_id} className="border-b last:border-0 border-gray-100 dark:border-gray-700/60">
              <td className="px-2 py-2">
                <PlayerNameLink name={p.player_name} playerId={p.player_id} className="font-semibold whitespace-nowrap text-gray-900 dark:text-gray-100 hover:underline" />
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {p.team}{p.dnp > 0 ? ` · ${p.dnp} DNP` : ''}
                </div>
              </td>
              <td className="px-2 py-1"><GameStrip games={p.games} /></td>
              <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">
                {p.proj_pts.toFixed(1)} → {p.actual_pts.toFixed(1)}{' '}
                <span className={`text-xs ${dPts >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>({formatSigned(dPts)})</span>
              </td>
              <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">
                {p.proj_min.toFixed(1)} → {p.actual_min.toFixed(1)}{' '}
                <span className="text-xs text-gray-500 dark:text-gray-400">({formatSigned(dMin)})</span>
              </td>
              <td className="px-2 py-2"><FlagBadge flag={p.flag} /></td>
            </tr>
          )
        })}
      </tbody>
    </table>
  </div>
)

export default PlayersAccuracyTable

import { useState } from 'react'
import type { PlayerAccuracyRow } from '../../types/api'
import PlayerNameLink from '../PlayerNameLink'
import GameStrip from './GameStrip'
import FlagBadge from './FlagBadge'
import { formatSigned, rankPlayers } from '../../utils/modelAccuracy'

const INITIAL_ROWS = 15

function PtsDelta({ p }: { p: PlayerAccuracyRow }) {
  const d = p.actual_pts - p.proj_pts
  return (
    <span className={`text-xs ${d >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>({formatSigned(d)})</span>
  )
}

/** Ranked most-out-of-line first and capped; on phones the stat columns fold
 *  into the player cell so the row is name + strip. */
const PlayersAccuracyTable = ({ rows }: { rows: PlayerAccuracyRow[] }) => {
  const [showAll, setShowAll] = useState(false)
  const ranked = rankPlayers(rows)
  const shown = showAll ? ranked : ranked.slice(0, INITIAL_ROWS)

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <th className="text-left font-medium px-2 py-1.5">Player</th>
              <th className="text-left font-medium px-2 py-1.5 whitespace-nowrap">Last games</th>
              <th className="hidden sm:table-cell text-right font-medium px-2 py-1.5 whitespace-nowrap">PTS proj → actual</th>
              <th className="hidden md:table-cell text-right font-medium px-2 py-1.5 whitespace-nowrap">MIN proj → actual</th>
              <th className="hidden sm:table-cell text-left font-medium px-2 py-1.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(p => (
              <tr key={p.player_id} className="border-b last:border-0 border-gray-100 dark:border-gray-700/60">
                <td className="px-2 py-2 align-top sm:align-middle">
                  <PlayerNameLink name={p.player_name} playerId={p.player_id} className="font-semibold text-gray-900 dark:text-gray-100 hover:underline" />
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {p.team}{p.dnp > 0 ? ` · ${p.dnp} DNP` : ''}
                  </div>
                  <div className="sm:hidden mt-1 grid gap-1 justify-items-start">
                    <FlagBadge flag={p.flag} />
                    <span className="text-xs tabular-nums text-gray-600 dark:text-gray-300">
                      PTS {p.proj_pts.toFixed(1)} → {p.actual_pts.toFixed(1)} <PtsDelta p={p} />
                    </span>
                  </div>
                </td>
                <td className="px-2 py-1"><GameStrip games={p.games} /></td>
                <td className="hidden sm:table-cell px-2 py-2 text-right tabular-nums whitespace-nowrap">
                  {p.proj_pts.toFixed(1)} → {p.actual_pts.toFixed(1)} <PtsDelta p={p} />
                </td>
                <td className="hidden md:table-cell px-2 py-2 text-right tabular-nums whitespace-nowrap">
                  {p.proj_min.toFixed(1)} → {p.actual_min.toFixed(1)}{' '}
                  <span className="text-xs text-gray-500 dark:text-gray-400">({formatSigned(p.actual_min - p.proj_min)})</span>
                </td>
                <td className="hidden sm:table-cell px-2 py-2"><FlagBadge flag={p.flag} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ranked.length > INITIAL_ROWS && (
        <button
          type="button"
          onClick={() => setShowAll(v => !v)}
          className="mt-2 w-full sm:w-auto px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 text-blue-700 dark:text-blue-300 hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          {showAll ? 'Show fewer' : `Show all ${ranked.length} players`}
        </button>
      )}
    </div>
  )
}

export default PlayersAccuracyTable

import { useMemo, useState } from 'react'
import type { LeagueActivity } from '../../types/activity'
import { useMyTeam } from '../../context/MyTeamContext'
import { fantasyTeamOptionLabel, myTeamRowClass } from '../MyTeamMark'
import PlayerNameLink from '../PlayerNameLink'
import { categoryValue, formatCategory, formatDay, stintLine, type StatMode } from '../../utils/leagueActivity'
import { SELECT_CLASS, StatModeToggle } from './shared'
import { teamAbbrev, teamLookup } from './teams'

interface ReleasedPlayersProps {
  activity: LeagueActivity
  categories: string[]
  mode: StatMode
  onModeChange: (m: StatMode) => void
}

const ReleasedPlayers = ({ activity, categories, mode, onModeChange }: ReleasedPlayersProps) => {
  const { isMyTeam } = useMyTeam()
  const teams = useMemo(() => teamLookup(activity.teams), [activity.teams])
  const [by, setBy] = useState<number | null>(null)
  const rows = activity.released.filter(r => by === null || r.released_by === by)

  return (
    <div className="space-y-3 rounded-lg bg-white p-4 shadow-md dark:bg-gray-800">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Released players who played elsewhere</h2>
        <p className="mt-1 max-w-prose text-sm text-gray-600 dark:text-gray-300">
          Players a team released who were later picked up by another team, sorted by games played for the new team.
          Stats cover only the new team&apos;s stint, until that team released him too. Stints shorter than 5 games are left out.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-700 dark:text-gray-300">
        <label className="flex items-center gap-2">
          Released by
          <select id="released-by" className={SELECT_CLASS} value={by ?? ''} onChange={e => setBy(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Any team</option>
            {activity.teams.map(t => (
              <option key={t.team_id} value={t.team_id}>{fantasyTeamOptionLabel(t.name, isMyTeam(t.team_id))}</option>
            ))}
          </select>
        </label>
        <StatModeToggle mode={mode} onChange={onModeChange} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-xs text-gray-500 uppercase dark:border-gray-700 dark:text-gray-400">
              <th className="px-2 py-1.5 text-left font-semibold">Player</th>
              <th className="px-2 py-1.5 text-left font-semibold">Released by</th>
              <th className="px-2 py-1.5 text-left font-semibold">Picked up by</th>
              <th className="px-2 py-1.5 text-right font-semibold">GP after</th>
              {categories.map(cat => (
                <th key={cat} className="px-2 py-1.5 text-right font-semibold">{cat}</th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4 + categories.length} className="px-2 py-6 text-center text-gray-500 dark:text-gray-400">
                  {activity.released.length === 0
                    ? 'No released player has played 5 games for another team yet.'
                    : 'No released players from this team were picked up elsewhere.'}
                </td>
              </tr>
            ) : (
              rows.map(r => (
                <tr
                  key={`${r.player_id}-${r.released_by}`}
                  className={`border-b border-gray-100 dark:border-gray-700 ${myTeamRowClass(isMyTeam(r.released_by))}`}
                >
                  <td className="px-2 py-1.5 font-semibold whitespace-nowrap">
                    <PlayerNameLink name={r.name} playerId={r.player_id} className="text-gray-900 hover:underline dark:text-gray-100" />
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    {teamAbbrev(teams, r.released_by)}{' '}
                    <span className="text-xs text-gray-500 dark:text-gray-400">{formatDay(r.released_on)} · {r.games_before_release} GP</span>
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    {teamAbbrev(teams, r.stint.team_id)}{' '}
                    <span className="text-xs text-gray-500 dark:text-gray-400">{formatDay(r.stint.start)}</span>
                  </td>
                  <td className="px-2 py-1.5 text-right font-semibold">{r.stint.games_played}</td>
                  {categories.map(cat => (
                    <td key={cat} className="px-2 py-1.5 text-right">
                      {formatCategory(categoryValue(stintLine(r.stint), cat, mode), cat, mode)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default ReleasedPlayers

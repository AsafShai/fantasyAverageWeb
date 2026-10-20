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
  const emptyText = activity.released.length === 0
    ? 'No released player has played 5 games for another team yet.'
    : 'No released players from this team were picked up elsewhere.'

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
      <ul className="space-y-2 sm:hidden">
        {rows.length === 0 ? (
          <li className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">{emptyText}</li>
        ) : (
          rows.map(r => (
            <li
              key={`${r.player_id}-${r.released_by}`}
              className={`rounded-md border border-gray-200 p-2.5 text-sm dark:border-gray-700 ${myTeamRowClass(isMyTeam(r.released_by))}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <PlayerNameLink name={r.name} playerId={r.player_id} className="-my-1 inline-block py-1 font-semibold text-gray-900 hover:underline dark:text-gray-100" />
                <span className="shrink-0 text-xs font-semibold tabular-nums">{r.stint.games_played} GP after</span>
              </div>
              <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-300">
                Released by <b>{teamAbbrev(teams, r.released_by)}</b> {formatDay(r.released_on)} ({r.games_before_release} GP) · picked up by{' '}
                <b>{teamAbbrev(teams, r.stint.team_id)}</b> {formatDay(r.stint.start)}
              </p>
              <dl className="mt-1.5 grid grid-cols-4 gap-x-2 gap-y-1 text-xs tabular-nums">
                {categories.map(cat => (
                  <div key={cat} className="flex justify-between gap-1">
                    <dt className="text-gray-500 dark:text-gray-400">{cat}</dt>
                    <dd>{formatCategory(categoryValue(stintLine(r.stint), cat, mode), cat, mode)}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))
        )}
      </ul>
      <div className="hidden overflow-x-auto sm:block">
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
                  {emptyText}
                </td>
              </tr>
            ) : (
              rows.map(r => (
                <tr
                  key={`${r.player_id}-${r.released_by}`}
                  className={`border-b border-gray-100 dark:border-gray-700 ${myTeamRowClass(isMyTeam(r.released_by))}`}
                >
                  <td className="px-2 py-1.5 font-semibold whitespace-nowrap">
                    <PlayerNameLink name={r.name} playerId={r.player_id} className="-my-1 inline-block py-1 text-gray-900 hover:underline dark:text-gray-100" />
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

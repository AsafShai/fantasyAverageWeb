import { Fragment, useMemo, useState } from 'react'
import type { LeagueActivity } from '../../types/activity'
import { useMyTeam } from '../../context/MyTeamContext'
import { fantasyTeamOptionLabel } from '../MyTeamMark'
import { MOVE_FILTERS, filterMoves, formatDay, localDay, moveMatchesKind, type MoveFilter } from '../../utils/leagueActivity'
import MoveRow from './MoveRow'
import { SELECT_CLASS } from './shared'
import { teamLookup } from './teams'

const PAGE = 100

const timeOfDay = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

const ActivityFeed = ({ activity }: { activity: LeagueActivity }) => {
  const { isMyTeam } = useMyTeam()
  const teams = useMemo(() => teamLookup(activity.teams), [activity.teams])
  const [teamId, setTeamId] = useState<number | null>(null)
  const [kind, setKind] = useState<MoveFilter>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [shown, setShown] = useState(PAGE)

  const moves = useMemo(
    () => filterMoves(activity.moves, { teamId, kind: 'all', from, to }),
    [activity.moves, teamId, from, to],
  )
  const visible = useMemo(() => moves.filter(m => moveMatchesKind(m.kind, kind)), [moves, kind])
  const count = (k: MoveFilter) => moves.filter(m => moveMatchesKind(m.kind, k)).length

  const resetPaging = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setShown(PAGE)
  }

  const page = visible.slice(0, shown)
  return (
    <div className="space-y-3 rounded-lg bg-white p-4 shadow-md dark:bg-gray-800">
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm text-gray-700 sm:flex sm:flex-wrap sm:items-center sm:gap-x-4 dark:text-gray-300">
        <label className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
          Team
          <select
            id="activity-team"
            className={`${SELECT_CLASS} w-full sm:w-auto`}
            value={teamId ?? ''}
            onChange={e => resetPaging(setTeamId)(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">All teams</option>
            {activity.teams.map(t => (
              <option key={t.team_id} value={t.team_id}>
                {fantasyTeamOptionLabel(t.name, isMyTeam(t.team_id))}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
          Type
          <select id="activity-kind" className={`${SELECT_CLASS} w-full sm:w-auto`} value={kind} onChange={e => resetPaging(setKind)(e.target.value as MoveFilter)}>
            {MOVE_FILTERS.map(f => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
          From
          <input id="activity-from" type="date" className={`${SELECT_CLASS} w-full sm:w-auto`} value={from} max={to || undefined} onChange={e => resetPaging(setFrom)(e.target.value)} />
        </label>
        <label className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
          To
          <input id="activity-to" type="date" className={`${SELECT_CLASS} w-full sm:w-auto`} value={to} min={from || undefined} onChange={e => resetPaging(setTo)(e.target.value)} />
        </label>
      </div>

      <p className="text-xs text-gray-500 tabular-nums dark:text-gray-400">
        {count('all')} moves · {count('add')} adds · {count('drop')} drops · {count('waiver')} waiver claims · {count('trade')} trades
      </p>

      {visible.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
          {activity.moves.length === 0 ? 'No adds, drops or trades yet this season.' : 'No moves match these filters.'}
        </p>
      ) : (
        <ul>
          {page.map((m, i) => {
            const day = localDay(m.at)
            const header = i === 0 || day !== localDay(page[i - 1].at)
            return (
              <Fragment key={m.id}>
                {header && (
                  <li className="px-1 pt-3 pb-1 text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
                    {formatDay(day, { weekday: 'short', month: 'short', day: 'numeric' })}
                  </li>
                )}
                <MoveRow move={m} teams={teams} when={timeOfDay(m.at)} />
              </Fragment>
            )
          })}
        </ul>
      )}

      {visible.length > shown && (
        <button
          type="button"
          onClick={() => setShown(s => s + PAGE)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          Show more ({visible.length - shown} left)
        </button>
      )}
    </div>
  )
}

export default ActivityFeed

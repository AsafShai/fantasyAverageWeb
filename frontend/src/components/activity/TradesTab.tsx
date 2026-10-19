import { useMemo, useState } from 'react'
import type { LeagueActivity } from '../../types/activity'
import { useMyTeam } from '../../context/MyTeamContext'
import { fantasyTeamOptionLabel, myTeamRowClass } from '../MyTeamMark'
import { formatDay, type StatMode, type TradeOverrides } from '../../utils/leagueActivity'
import TradeDetail from './TradeDetail'
import { SELECT_CLASS, SideDot } from './shared'
import { teamAbbrev, teamLookup } from './teams'

interface TradesTabProps {
  activity: LeagueActivity
  categories: string[]
  selectedId: string | null
  onSelect: (id: string) => void
  onOpenTree: (tradeId: string, teamId: number) => void
  mode: StatMode
  onModeChange: (m: StatMode) => void
  overrides: TradeOverrides
  onOverridesChange: (o: TradeOverrides) => void
}

const TradesTab = ({
  activity, categories, selectedId, onSelect, onOpenTree, mode, onModeChange, overrides, onOverridesChange,
}: TradesTabProps) => {
  const { isMyTeam } = useMyTeam()
  const teams = useMemo(() => teamLookup(activity.teams), [activity.teams])
  const [teamId, setTeamId] = useState<number | null>(null)

  const list = useMemo(
    () => [...activity.trades].reverse().filter(t => teamId === null || t.sides.some(s => s.team_id === teamId)),
    [activity.trades, teamId],
  )
  const selected = activity.trades.find(t => t.id === selectedId) ?? list[0]

  if (activity.trades.length === 0) {
    return (
      <div className="rounded-lg bg-white p-6 text-center text-sm text-gray-500 shadow-md dark:bg-gray-800 dark:text-gray-400">
        No trades yet this season. Completed trades show up here with what each side got.
      </div>
    )
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[20rem_1fr]">
      <div className="min-w-0 overflow-hidden rounded-lg bg-white shadow-md dark:bg-gray-800">
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:text-gray-300">
          <label className="flex items-center gap-2">
            Team
            <select
              id="trades-team"
              className={SELECT_CLASS}
              value={teamId ?? ''}
              onChange={e => setTeamId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">All teams</option>
              {activity.teams.map(t => (
                <option key={t.team_id} value={t.team_id}>{fantasyTeamOptionLabel(t.name, isMyTeam(t.team_id))}</option>
              ))}
            </select>
          </label>
          <span className="text-xs text-gray-500 dark:text-gray-400">{list.length} trades</span>
        </div>
        <ul className="max-h-[22rem] overflow-y-auto lg:max-h-[46rem]">
          {list.map(t => {
            const mine = t.sides.some(s => isMyTeam(s.team_id))
            const current = t.id === selected?.id
            return (
              <li key={t.id}>
                <button
                  type="button"
                  aria-current={current || undefined}
                  onClick={() => onSelect(t.id)}
                  className={`block w-full space-y-1 border-b border-gray-100 px-3 py-2.5 text-left text-sm dark:border-gray-700 ${
                    current ? 'bg-blue-50 dark:bg-blue-950/50' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                  } ${myTeamRowClass(mine)}`}
                >
                  <span className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                    <span className="tabular-nums">{formatDay(t.date)}</span>
                    <span>{t.sides.reduce((n, s) => n + s.received.length, 0)} players</span>
                  </span>
                  {t.sides.map((s, i) => (
                    <span key={s.team_id} className="block text-gray-700 dark:text-gray-300">
                      <SideDot side={i as 0 | 1} />
                      <b className="text-gray-900 dark:text-gray-100">{teamAbbrev(teams, s.team_id)}</b> got{' '}
                      {s.received.map(p => p.name).join(', ') || 'nothing'}
                    </span>
                  ))}
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      {selected && (
        <TradeDetail
          trade={selected}
          trades={activity.trades}
          teams={teams}
          categories={categories}
          seasonOver={activity.season_over}
          mode={mode}
          onModeChange={onModeChange}
          overrides={overrides}
          onOverridesChange={onOverridesChange}
          onSelectTrade={onSelect}
          onOpenTree={onOpenTree}
        />
      )}
    </div>
  )
}

export default TradesTab

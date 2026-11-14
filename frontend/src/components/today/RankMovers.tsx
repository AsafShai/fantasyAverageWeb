import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { useSort } from '../../hooks/useSort'
import SortableHeaderCell from './SortableHeaderCell'
import MultiSelectFilter from './MultiSelectFilter'
import type { LiveBlock, RankMover } from '../../types/api'
import { liveMoment } from '../../utils/live'
import { moversSubtitle, type MoversView } from '../../utils/liveTonight'
import { MyTeamMark } from '../MyTeamMark'
import { leadWithMyTeam, myTeamRowClass } from '../../myTeam/display'
import { useMyTeam } from '../../context/useMyTeam'

interface RankMoversProps {
  /** Day over day (the latest official day vs the day before). */
  movers: RankMover[]
  /** While tonight is live: movers vs this morning's official standings. */
  tonightMovers?: RankMover[]
  live?: LiveBlock
}

const SEG = 'min-h-7 rounded px-2.5 py-0.5 text-[11px] font-semibold transition-colors'
const SEG_ON = 'bg-white text-blue-700 shadow-sm dark:bg-gray-600 dark:text-blue-200'
const SEG_OFF = 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100'

/** Tonight / vs yesterday, shown only while tonight is live or final (design canvas, Today). */
export function MoversSwitch({ view, onView }: { view: MoversView; onView: (v: MoversView) => void }) {
  return (
    <div className="flex gap-0.5 rounded-md bg-gray-100 p-0.5 dark:bg-gray-700" role="group" aria-label="Rank movers period">
      <button type="button" aria-pressed={view === 'tonight'} onClick={() => onView('tonight')} className={`${SEG} ${view === 'tonight' ? SEG_ON : SEG_OFF}`}>
        Tonight
      </button>
      <button type="button" aria-pressed={view === 'yesterday'} onClick={() => onView('yesterday')} className={`${SEG} ${view === 'yesterday' ? SEG_ON : SEG_OFF}`}>
        vs yesterday
      </button>
    </div>
  )
}

type SortKey = 'team' | 'category' | 'delta'

const COMPARATORS: Record<SortKey, (a: RankMover, b: RankMover) => number> = {
  team: (a, b) => a.team_name.localeCompare(b.team_name),
  category: (a, b) => a.category.localeCompare(b.category),
  delta: (a, b) => a.delta - b.delta,
}

function formatDelta(delta: number): string {
  const rounded = Math.abs(delta) % 1 === 0 ? Math.abs(delta).toFixed(0) : Math.abs(delta).toFixed(1)
  return `${delta > 0 ? '▲' : '▼'} ${rounded}`
}

export default function RankMovers({ movers: lastNight, tonightMovers, live }: RankMoversProps) {
  const [view, setView] = useState<MoversView>('tonight')
  const switchable = !!liveMoment(live) && tonightMovers !== undefined
  const movers = switchable && view === 'tonight' ? tonightMovers : lastNight
  const subtitle = switchable ? moversSubtitle(live, view) : null
  const navigate = useNavigate()
  const { myTeamId, isMyTeam } = useMyTeam()
  const [selectedTeams, setSelectedTeams] = useState<string[]>([])
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])

  const teamOptions = useMemo(
    () => Array.from(new Set(movers.map(m => m.team_name))).sort((a, b) => a.localeCompare(b)),
    [movers],
  )

  const categoryOptions = useMemo(
    () => Array.from(new Set(movers.map(m => m.category))).sort((a, b) => a.localeCompare(b)),
    [movers],
  )

  const filtered = useMemo(
    () =>
      movers.filter(
        m =>
          (selectedTeams.length === 0 || selectedTeams.includes(m.team_name)) &&
          (selectedCategories.length === 0 || selectedCategories.includes(m.category)),
      ),
    [movers, selectedTeams, selectedCategories],
  )

  const ordered = leadWithMyTeam(filtered, myTeamId)
  const { sorted, sortKey, direction, toggle } = useSort<RankMover, SortKey>(ordered, COMPARATORS)

  return (
    <div className="flex min-w-0 flex-col rounded-lg bg-white p-4 shadow dark:bg-gray-800">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
        <h2 className="text-base font-bold text-gray-900 sm:text-lg dark:text-gray-50">Rank movers</h2>
        <div className="flex flex-wrap items-center gap-2">
          {switchable
            ? <MoversSwitch view={view} onView={setView} />
            : <span className="text-[11px] text-gray-400 dark:text-gray-500">vs yesterday</span>}
          {movers.length > 0 && (
            <>
              <MultiSelectFilter label="teams" options={teamOptions} selected={selectedTeams} onChange={setSelectedTeams} />
              <MultiSelectFilter
                label="categories"
                options={categoryOptions}
                selected={selectedCategories}
                onChange={setSelectedCategories}
              />
            </>
          )}
        </div>
      </div>

      {subtitle && <p className="pb-1 text-[11px] text-gray-500 dark:text-gray-400">{subtitle}</p>}

      {movers.length === 0 ? (
        <p className="py-3 text-xs text-gray-500 dark:text-gray-400">
          {switchable && view === 'tonight' ? 'No rank changes yet tonight.' : 'Movers appear after the second scoring period.'}
        </p>
      ) : sorted.length === 0 ? (
        <p className="py-3 text-xs text-gray-500 dark:text-gray-400">No movers match the selected filters.</p>
      ) : (
        <div className="relative min-h-[60vh] flex-1 md:min-h-0">
          <div className="absolute inset-0 overflow-x-auto overflow-y-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-600">
                  <SortableHeaderCell
                    label="Team"
                    active={sortKey === 'team'}
                    direction={direction}
                    onSort={() => toggle('team')}
                    className="sticky top-0 z-10"
                  />
                  <SortableHeaderCell
                    label="Cat"
                    active={sortKey === 'category'}
                    direction={direction}
                    onSort={() => toggle('category')}
                    className="sticky top-0 z-10"
                  />
                  <SortableHeaderCell
                    label="Δ"
                    active={sortKey === 'delta'}
                    direction={direction}
                    align="right"
                    onSort={() => toggle('delta')}
                    className="sticky top-0 z-10"
                  />
                </tr>
              </thead>
              <tbody>
                {sorted.map(mover => (
                  <tr
                    key={`${mover.team_id}-${mover.category}`}
                    onClick={() => navigate(`/team/${mover.team_id}`)}
                    className="cursor-pointer border-b border-gray-100 last:border-0 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700"
                  >
                    <td className={`max-w-[8rem] px-1.5 py-1.5 text-xs text-gray-900 sm:max-w-[11rem] sm:px-3 sm:text-sm dark:text-gray-100 ${myTeamRowClass(isMyTeam(mover.team_id))}`}>
                      <span className="inline-flex max-w-full items-center">
                        <span className="truncate">{mover.team_name}</span>
                        <MyTeamMark teamId={mover.team_id} />
                      </span>
                    </td>
                    <td className="px-1.5 py-1.5 sm:px-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          mover.category === 'TOTAL'
                            ? 'bg-gray-800 text-gray-50 dark:bg-gray-200 dark:text-gray-900'
                            : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                        }`}
                      >
                        {mover.category}
                      </span>
                    </td>
                    <td
                      className={`px-1.5 py-1.5 text-right text-xs font-bold tabular-nums sm:px-2 sm:text-sm ${
                        mover.delta > 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {formatDelta(mover.delta)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

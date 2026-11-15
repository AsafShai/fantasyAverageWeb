import { Fragment, useMemo, useState } from 'react'
import type { ActivityTeam, PlayerLeagueHistory, PlayerStintStats } from '../../types/activity'
import {
  categoryValue,
  formatCategory,
  type StatLine,
  type StatMode,
} from '../../utils/leagueActivity'
import { teamColors } from '../../utils/playerLeagueHistory'

const ROLE_CLASS: Record<string, string> = {
  Started: 'text-emerald-700 dark:text-emerald-400',
  Bench: 'text-gray-500 dark:text-gray-400',
  IR: 'text-amber-700 dark:text-amber-400',
}

function dayLabel(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function spanLabel(stint: PlayerStintStats): string {
  const start = dayLabel(stint.start)
  if (stint.current) return `${start} – now`
  const end = dayLabel(stint.end)
  return start === end ? start : `${start} – ${end}`
}

function unsplitLabel(n: number): string {
  return `${n} ${n === 1 ? 'game' : 'games'} not split`
}

function cell(line: StatLine, cat: string, mode: StatMode): string {
  return formatCategory(categoryValue(line, cat, mode), cat, mode)
}

function StatCells({
  line, cats, mode, summary, bg, rule,
}: {
  line: StatLine
  cats: string[]
  mode: StatMode
  summary?: boolean
  bg: string
  rule: string
}) {
  return (
    <>
      {cats.map((cat) => {
        const value = cell(line, cat, mode)
        const empty = value === '–'
        return (
          <td
            key={cat}
            className={`border-t px-1.5 py-2 text-right tabular-nums whitespace-nowrap md:px-2.5 ${rule} ${bg} ${
              empty
                ? 'text-gray-300 dark:text-gray-600'
                : summary
                  ? 'font-medium text-gray-900 dark:text-gray-100'
                  : 'text-gray-600 dark:text-gray-300'
            }`}
          >
            {value}
          </td>
        )
      })}
    </>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 12 12" className={`h-3 w-3 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}>
      <path d="M4.5 2.5l3.5 3.5-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const STICKY = 'sticky left-0 z-10 md:static'

type SortDir = 'asc' | 'desc'
type SortKey = string
type Sort = { key: SortKey; dir: SortDir }

function teamLine(stint: PlayerStintStats): StatLine {
  return { gp: stint.games_played, totals: stint.totals }
}

function teamLabel(stint: PlayerStintStats, teams: Map<number, ActivityTeam>): string {
  const team = teams.get(stint.team_id)
  return (team?.name || team?.abbrev || `Team ${stint.team_id}`).toLowerCase()
}

/** The team's own line. Null means there is nothing to rank, so it stays at the bottom. */
function sortValue(stint: PlayerStintStats, key: SortKey, mode: StatMode, teams: Map<number, ActivityTeam>): number | string | null {
  if (key === 'team') return teamLabel(stint, teams)
  if (key === 'gp') return stint.games_played
  return categoryValue(teamLine(stint), key, mode)
}

function compareStints(
  a: PlayerStintStats, b: PlayerStintStats, sort: Sort, mode: StatMode, teams: Map<number, ActivityTeam>,
): number {
  const av = sortValue(a, sort.key, mode, teams)
  const bv = sortValue(b, sort.key, mode, teams)
  const aMissing = av === null
  const bMissing = bv === null
  if (aMissing || bMissing) return aMissing === bMissing ? 0 : aMissing ? 1 : -1
  const cmp = typeof av === 'string' && typeof bv === 'string' ? av.localeCompare(bv) : (av as number) - (bv as number)
  return sort.dir === 'asc' ? cmp : -cmp
}

function SortHead({
  label, column, sort, onSort, align, className,
}: {
  label: string
  column: SortKey
  sort: Sort | null
  onSort: (column: SortKey) => void
  align: 'left' | 'right'
  className: string
}) {
  const active = sort?.key === column
  return (
    <th scope="col" aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={className}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`inline-flex items-center gap-0.5 bg-transparent p-0 font-semibold uppercase tracking-wide text-inherit hover:text-gray-700 dark:hover:text-gray-200 ${
          align === 'right' ? 'w-full justify-end' : ''
        }`}
      >
        {label}
        {active && <span aria-hidden="true" className="text-[9px]">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
      </button>
    </th>
  )
}

function TeamTable({
  stints, teams, cats, mode, colors,
}: {
  stints: PlayerStintStats[]
  teams: Map<number, ActivityTeam>
  cats: string[]
  mode: StatMode
  colors: Map<number, string>
}) {
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set())
  const [sort, setSort] = useState<Sort | null>(null)
  const ordered = useMemo(() => {
    if (!sort) return stints
    return stints
      .map((stint, index) => ({ stint, index }))
      .sort((a, b) => compareStints(a.stint, b.stint, sort, mode, teams) || a.index - b.index)
      .map(({ stint }) => stint)
  }, [stints, sort, mode, teams])
  const onSort = (column: SortKey) => setSort((prev) => {
    if (!prev || prev.key !== column) return { key: column, dir: column === 'team' ? 'asc' : 'desc' }
    return { key: column, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
  })
  const headBg = 'bg-gray-50 font-semibold dark:bg-gray-800/80'
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700" data-testid="stint-table">
      <table className="w-full border-separate border-spacing-0 text-[11px] md:text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-gray-400">
            <SortHead label="Team" column="team" sort={sort} onSort={onSort} align="left" className={`px-2 py-2 text-left ${headBg} ${STICKY}`} />
            <SortHead label="GP" column="gp" sort={sort} onSort={onSort} align="right" className={`px-1.5 py-2 text-right md:px-2.5 ${headBg}`} />
            {cats.map((cat) => (
              <SortHead key={cat} label={cat} column={cat} sort={sort} onSort={onSort} align="right" className={`px-1.5 py-2 text-right md:px-2.5 ${headBg}`} />
            ))}
          </tr>
        </thead>
        <tbody>
          {ordered.map((stint) => {
            const key = `${stint.team_id}-${stint.start}`
            const open = openKeys.has(key)
            const team = teams.get(stint.team_id)
            const abbrev = team?.abbrev ?? `Team ${stint.team_id}`
            const color = colors.get(stint.team_id)
            const all: StatLine = { gp: stint.games_played, totals: stint.totals }
            const details = [
              { label: 'Started', line: stint.started },
              { label: 'Bench', line: stint.bench },
              ...(stint.ir && stint.ir.gp > 0 ? [{ label: 'IR', line: stint.ir }] : []),
            ]
            const toggle = () => setOpenKeys((prev) => {
              const next = new Set(prev)
              if (next.has(key)) next.delete(key)
              else next.add(key)
              return next
            })
            const face = open
              ? 'bg-gray-50 dark:bg-gray-800/70'
              : 'bg-white group-hover:bg-gray-50 dark:bg-gray-900 dark:group-hover:bg-gray-800/60'
            const edge = color && open ? { boxShadow: `inset 3px 0 0 ${color}` } : undefined
            return (
              <Fragment key={key}>
                <tr className="group cursor-pointer" onClick={toggle}>
                  <th scope="row" style={edge} className={`whitespace-nowrap border-t border-gray-200 px-2 py-2 text-left align-middle font-normal dark:border-gray-700 ${STICKY} ${face}`}>
                    <button type="button" aria-expanded={open} className="block text-left">
                      <span className="flex items-center gap-1.5">
                        <Chevron open={open} />
                        {color && <i aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: color }} />}
                        <span className="font-semibold text-gray-900 dark:text-gray-100">{abbrev}</span>
                        {team?.name && (
                          <span className="hidden font-normal text-gray-500 dark:text-gray-400 md:inline">{team.name}</span>
                        )}
                        <span className="hidden text-gray-300 dark:text-gray-600 md:inline">·</span>
                        <span className="hidden font-normal text-gray-400 tabular-nums md:inline">{spanLabel(stint)}</span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-1 pl-4 font-normal text-[10px] text-gray-400 tabular-nums md:hidden">
                        <span>{spanLabel(stint)}</span>
                      </span>
                      {stint.unsplit_games > 0 && (
                        <span className="mt-0.5 block pl-4 text-[10px] font-normal text-gray-400">{unsplitLabel(stint.unsplit_games)}</span>
                      )}
                    </button>
                  </th>
                  <td className={`border-t border-gray-200 px-1.5 py-2 text-right tabular-nums whitespace-nowrap dark:border-gray-700 md:px-2.5 ${face} ${all.gp ? 'font-medium text-gray-900 dark:text-gray-100' : 'text-gray-300 dark:text-gray-600'}`}>
                    {all.gp}
                  </td>
                  <StatCells line={all} cats={cats} mode={mode} summary bg={face} rule="border-gray-200 dark:border-gray-700" />
                </tr>
                {open && details.map((role) => (
                  <tr key={role.label}>
                    <th
                      scope="row"
                      style={edge}
                      className={`border-t border-gray-100 px-2 py-1.5 pl-8 text-left font-medium dark:border-gray-800 ${STICKY} bg-gray-50 dark:bg-gray-800/70 ${ROLE_CLASS[role.label]}`}
                    >
                      {role.label}
                    </th>
                    <td className={`border-t border-gray-100 px-1.5 py-1.5 text-right tabular-nums whitespace-nowrap dark:border-gray-800 md:px-2.5 bg-gray-50 dark:bg-gray-800/70 ${role.line.gp ? 'text-gray-600 dark:text-gray-300' : 'text-gray-300 dark:text-gray-600'}`}>
                      {role.line.gp}
                    </td>
                    <StatCells line={role.line} cats={cats} mode={mode} bg="bg-gray-50 dark:bg-gray-800/70" rule="border-gray-100 dark:border-gray-800" />
                  </tr>
                ))}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** One fantasy-team stretch: the games he played for them, split by the locked slot. */
export default function StintStats({ history }: { history: PlayerLeagueHistory }) {
  const [mode, setMode] = useState<StatMode>('per_game')
  const ready = history.stint_stats_ready !== false
  const stints = history.stint_stats ?? []
  if (ready && stints.length === 0) return null

  const teams = new Map(history.teams.map((t) => [t.team_id, t]))
  const cats = history.categories ?? []
  const colors = teamColors(history.stints)

  return (
    <section aria-label="With each team">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          With each team
        </div>
        {ready && (
          <div className="inline-flex rounded-md border border-gray-200 p-0.5 dark:border-gray-700" role="group" aria-label="Per game or totals">
            {([['per_game', 'Per game'], ['totals', 'Totals']] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
                className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                  mode === value
                    ? 'bg-gray-900 !text-white dark:bg-white dark:!text-gray-900'
                    : '!text-gray-500 hover:!text-gray-800 dark:!text-gray-400 dark:hover:!text-gray-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      {!ready ? (
        <p className="text-sm text-gray-400">Stat lines could not be loaded.</p>
      ) : (
        <TeamTable stints={stints} teams={teams} cats={cats} mode={mode} colors={colors} />
      )}
    </section>
  )
}

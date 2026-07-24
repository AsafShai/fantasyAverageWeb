import { useMemo, useState } from 'react'
import {
  useGetTrendsMinutesQuery,
  useGetTrendsUsageQuery,
  useGetTrendsRegressionQuery,
} from '../store/api/fantasyApi'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import type { MinutesMoverItem, UsageRoleItem, RegressionPlayerGroup, RegressionStatItem } from '../types/api'

type TabKey = 'minutes' | 'usage' | 'regression'

const ALL_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C']

interface SharedFilterable {
  player_name: string
  position: string
  games_last_15d: number
}

function passesShared<T extends SharedFilterable>(
  row: T,
  { nameFilter, position, minG15 }: { nameFilter: string; position: string | null; minG15: number }
): boolean {
  if (position && row.position !== position) return false
  if (row.games_last_15d < minG15) return false
  if (nameFilter.trim() && !row.player_name.toLowerCase().includes(nameFilter.trim().toLowerCase())) return false
  return true
}

function StatusBadge({ fantasyStatus }: { fantasyStatus: string }) {
  if (fantasyStatus === 'FA') {
    return <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300">FA</span>
  }
  return <span className="text-gray-400 dark:text-gray-500 text-xs">{fantasyStatus}</span>
}

function DeltaPill({ value, unit, decimals = 1 }: { value: number; unit: string; decimals?: number }) {
  const up = value >= 0
  const sign = up ? '+' : ''
  return (
    <span
      className={`inline-flex items-center gap-1 font-bold px-2 py-0.5 rounded-full text-xs whitespace-nowrap ${
        up
          ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400'
          : 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400'
      }`}
    >
      {up ? '▲' : '▼'} {sign}{value.toFixed(decimals)}{unit}
    </span>
  )
}

function Th({ col, label, sortCol, sortAsc, onSort, className = '', title }: {
  col: string
  label: string
  sortCol: string
  sortAsc: boolean
  onSort: (col: string) => void
  className?: string
  title?: string
}) {
  const active = sortCol === col
  return (
    <th
      onClick={() => onSort(col)}
      tabIndex={0}
      role="button"
      title={title}
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onSort(col)}
      aria-sort={active ? (sortAsc ? 'ascending' : 'descending') : 'none'}
      className={`px-1.5 sm:px-3 py-2 text-left text-[10px] sm:text-xs font-semibold uppercase tracking-wide cursor-pointer select-none whitespace-nowrap ${active ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'} ${className}`}
    >
      {label}{active ? (sortAsc ? ' ▲' : ' ▼') : ''}
    </th>
  )
}

function EmptyRow({ colSpan }: { colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="text-center text-gray-400 dark:text-gray-500 py-8 text-sm">
        No players match current filters.
      </td>
    </tr>
  )
}

const MIN_SORT_VAL: Record<string, (r: MinutesMoverItem) => number | string> = {
  player: r => r.player_name,
  team: r => r.pro_team,
  pos: r => r.position,
  season: r => r.season_mpg,
  l5: r => r.l5_mpg,
  delta: r => r.delta_mpg,
  gp: r => r.season_gp,
  g15: r => r.games_last_15d,
}

function MinutesTable({ items, filters, windowDays }: { items: MinutesMoverItem[]; filters: { nameFilter: string; position: string | null; minG15: number }; windowDays: number }) {
  const [sortCol, setSortCol] = useState('delta')
  const [sortAsc, setSortAsc] = useState(false)

  const rows = useMemo(() => {
    const filtered = items.filter(r => passesShared(r, filters))
    const getVal = MIN_SORT_VAL[sortCol] ?? MIN_SORT_VAL.delta
    return [...filtered].sort((a, b) => {
      const av = getVal(a), bv = getVal(b)
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number)
      return sortAsc ? cmp : -cmp
    })
  }, [items, filters, sortCol, sortAsc])

  const handleSort = (col: string) => {
    if (col === sortCol) setSortAsc(a => !a)
    else { setSortCol(col); setSortAsc(false) }
  }

  return (
    <div className="overflow-x-auto rounded-lg">
      <table className="w-full text-xs sm:text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
            <Th col="player" label="Player" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} className="sticky left-0 z-10 bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700" />
            <Th col="team" label="Team" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} className="hidden sm:table-cell" title="NBA team" />
            <Th col="pos" label="Pos" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} className="hidden sm:table-cell" title="Position" />
            <Th col="season" label="Season MPG" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} title="Minutes per game, full season" />
            <Th col="l5" label={`${windowDays}d MPG`} sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} title={`Minutes per game over the last ${windowDays} days`} />
            <Th col="delta" label="Δ MPG" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} title={`Change: ${windowDays}d MPG minus season MPG`} />
            <Th col="gp" label="GP" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} className="hidden sm:table-cell" title="Games played this season" />
            <Th col="g15" label={`G(${windowDays}d)`} sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} className="hidden sm:table-cell" title={`Games played in the last ${windowDays} days`} />
            <th className="px-1.5 sm:px-3 py-2 text-left text-[10px] sm:text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400" title="Fantasy owner, or FA if unrostered">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <EmptyRow colSpan={9} />}
          {rows.map(r => (
            <tr key={`${r.player_name}-${r.pro_team}`} className="group border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
              <td className="px-1.5 sm:px-3 py-1.5 sm:py-2 font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap sticky left-0 z-10 bg-white dark:bg-gray-800 group-hover:bg-gray-50 dark:group-hover:bg-gray-700/50 border-r border-gray-200 dark:border-gray-700">
                {r.player_name}
                {r.low_sample && <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">partial</span>}
              </td>
              <td className="hidden sm:table-cell px-3 py-2 text-gray-500 dark:text-gray-400">{r.pro_team}</td>
              <td className="hidden sm:table-cell px-3 py-2 text-gray-500 dark:text-gray-400">{r.position}</td>
              <td className="px-1.5 sm:px-3 py-1.5 sm:py-2 text-gray-700 dark:text-gray-300">{r.season_mpg.toFixed(1)}</td>
              <td className="px-1.5 sm:px-3 py-1.5 sm:py-2 text-gray-700 dark:text-gray-300">{r.l5_mpg.toFixed(1)}</td>
              <td className="px-1.5 sm:px-3 py-1.5 sm:py-2"><DeltaPill value={r.delta_mpg} unit="" /></td>
              <td className="hidden sm:table-cell px-3 py-2 text-gray-700 dark:text-gray-300">{r.season_gp}</td>
              <td className="hidden sm:table-cell px-3 py-2 text-gray-700 dark:text-gray-300">{r.games_last_15d}</td>
              <td className="px-1.5 sm:px-3 py-1.5 sm:py-2"><StatusBadge fantasyStatus={r.fantasy_status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const USG_SORT_VAL: Record<string, (r: UsageRoleItem) => number | string> = {
  player: r => r.player_name,
  team: r => r.pro_team,
  season: r => r.season_usg,
  l5: r => r.l5_usg,
  delta: r => r.delta_usg,
  dmpg: r => r.delta_mpg,
  g15: r => r.games_last_15d,
}

function RoleBadge({ badge }: { badge: string | null }) {
  if (!badge) return <span className="text-gray-400 dark:text-gray-500">—</span>
  const up = badge.includes('↑')
  return (
    <span className={`inline-block text-[10.5px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${up ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400' : 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400'}`}>
      {badge}
    </span>
  )
}

function UsageTable({ items, filters, windowDays }: { items: UsageRoleItem[]; filters: { nameFilter: string; position: string | null; minG15: number }; windowDays: number }) {
  const [sortCol, setSortCol] = useState('delta')
  const [sortAsc, setSortAsc] = useState(false)

  const rows = useMemo(() => {
    const filtered = items.filter(r => passesShared(r, filters))
    const getVal = USG_SORT_VAL[sortCol] ?? USG_SORT_VAL.delta
    return [...filtered].sort((a, b) => {
      const av = getVal(a), bv = getVal(b)
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number)
      return sortAsc ? cmp : -cmp
    })
  }, [items, filters, sortCol, sortAsc])

  const handleSort = (col: string) => {
    if (col === sortCol) setSortAsc(a => !a)
    else { setSortCol(col); setSortAsc(false) }
  }

  return (
    <div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
        <b>Role ↑/↓</b> = minutes AND usage moved together (≥4 MPG and ≥2pp usage). <b>Minutes ↑/↓</b> = minutes moved, usage didn't.{' '}
        <b>Usage ↑/↓</b> = usage moved on flat minutes. Δ USG / Δ MPG columns show the raw numbers behind each label.
      </p>
      <div className="overflow-x-auto rounded-lg">
        <table className="w-full text-xs sm:text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
              <Th col="player" label="Player" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} className="sticky left-0 z-10 bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700" />
              <Th col="team" label="Team" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} className="hidden sm:table-cell" title="NBA team" />
              <Th col="season" label="Season USG%" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} title="Usage rate (% of team plays used by this player while on court), full season" />
              <Th col="l5" label={`${windowDays}d USG%`} sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} title={`Usage rate over the last ${windowDays} days`} />
              <Th col="delta" label="Δ USG" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} title={`Change: ${windowDays}d usage rate minus season usage rate, in percentage points`} />
              <Th col="dmpg" label="Δ MPG" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} className="hidden sm:table-cell" title={`Change: ${windowDays}d MPG minus season MPG`} />
              <Th col="g15" label={`G(${windowDays}d)`} sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} className="hidden sm:table-cell" title={`Games played in the last ${windowDays} days`} />
              <th className="px-1.5 sm:px-3 py-2 text-left text-[10px] sm:text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400" title="Role change label based on ΔUSG and ΔMPG thresholds — see note above">Role</th>
              <th className="px-1.5 sm:px-3 py-2 text-left text-[10px] sm:text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400" title="Fantasy owner, or FA if unrostered">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={9} />}
            {rows.map(r => (
              <tr key={`${r.player_name}-${r.pro_team}`} className="group border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                <td className="px-1.5 sm:px-3 py-1.5 sm:py-2 font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap sticky left-0 z-10 bg-white dark:bg-gray-800 group-hover:bg-gray-50 dark:group-hover:bg-gray-700/50 border-r border-gray-200 dark:border-gray-700">{r.player_name}</td>
                <td className="hidden sm:table-cell px-3 py-2 text-gray-500 dark:text-gray-400">{r.pro_team}</td>
                <td className="px-1.5 sm:px-3 py-1.5 sm:py-2 text-gray-700 dark:text-gray-300">{r.season_usg.toFixed(1)}%</td>
                <td className="px-1.5 sm:px-3 py-1.5 sm:py-2 text-gray-700 dark:text-gray-300">{r.l5_usg.toFixed(1)}%</td>
                <td className="px-1.5 sm:px-3 py-1.5 sm:py-2"><DeltaPill value={r.delta_usg} unit="pp" /></td>
                <td className="hidden sm:table-cell px-3 py-2 text-gray-700 dark:text-gray-300">{r.delta_mpg >= 0 ? '+' : ''}{r.delta_mpg.toFixed(1)}mpg</td>
                <td className="hidden sm:table-cell px-3 py-2 text-gray-700 dark:text-gray-300">{r.games_last_15d}</td>
                <td className="px-1.5 sm:px-3 py-1.5 sm:py-2"><RoleBadge badge={r.role_badge} /></td>
                <td className="px-1.5 sm:px-3 py-1.5 sm:py-2"><StatusBadge fantasyStatus={r.fantasy_status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const REG_SORT_VAL: Record<string, (s: RegressionStatItem) => number | string> = {
  stat: s => s.stat,
  cur: s => s.current_pct,
  base: s => s.baseline_pct,
  dev: s => s.dev,
  att: s => s.attempts_per_game,
  drift: s => s.drift_score,
}

function expectedDriftText(stat: RegressionStatItem): string {
  if (stat.stat === '3P%') {
    return `${(stat.attempts_per_game * (-stat.dev) / 100).toFixed(2)} 3PM/g`
  }
  return `${Math.abs(stat.dev).toFixed(1)}pp on ${stat.attempts_per_game.toFixed(1)}/g`
}

function RegressionTable({ items, filters, windowDays }: { items: RegressionPlayerGroup[]; filters: { nameFilter: string; position: string | null; minG15: number }; windowDays: number }) {
  const [sortCol, setSortCol] = useState('dev')
  const [sortAsc, setSortAsc] = useState(false)
  const [statFilter, setStatFilter] = useState<'all' | '3P%' | 'FT%' | 'FG%'>('all')

  const groups = useMemo(() => {
    const filtered = items
      .filter(g => passesShared(g, filters))
      .map(g => ({ ...g, stats: statFilter === 'all' ? g.stats : g.stats.filter(s => s.stat === statFilter) }))
      .filter(g => g.stats.length > 0)

    const getVal = REG_SORT_VAL[sortCol] ?? REG_SORT_VAL.dev
    const identityCol = sortCol === 'stat' ? false : ['player', 'team', 'g15'].includes(sortCol)

    const withKey = filtered.map(g => {
      const sortedStats = [...g.stats].sort((a, b) => Math.abs(b.dev) - Math.abs(a.dev))
      let key: number | string
      if (identityCol) {
        key = sortCol === 'player' ? g.player_name : sortCol === 'team' ? g.pro_team : g.games_last_15d
      } else {
        const extreme = sortedStats.reduce((best, s) => (Math.abs(getVal(s) as number) > Math.abs(getVal(best) as number) ? s : best), sortedStats[0])
        key = getVal(extreme)
      }
      return { group: g, stats: sortedStats, key }
    })

    withKey.sort((a, b) => {
      const cmp = typeof a.key === 'string' ? a.key.localeCompare(b.key as string) : (a.key as number) - (b.key as number)
      return sortAsc ? cmp : -cmp
    })

    return withKey
  }, [items, filters, statFilter, sortCol, sortAsc])

  const handleSort = (col: string) => {
    if (col === sortCol) setSortAsc(a => !a)
    else { setSortCol(col); setSortAsc(false) }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <select
          value={statFilter}
          onChange={e => setStatFilter(e.target.value as typeof statFilter)}
          className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-xs"
        >
          <option value="all">All stats</option>
          <option value="3P%">3P%</option>
          <option value="FT%">FT%</option>
          <option value="FG%">FG%</option>
        </select>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
        Filter: fantasy-relevant swing ≥ 0.35 makes/g-equivalent (attempts/g × |dev|), volume-weighted. Grouped by player: worst-offending stat surfaces first.
      </p>
      <div className="overflow-x-auto rounded-lg">
        <table className="w-full text-xs sm:text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
              <Th col="player" label="Player" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} className="sticky left-0 z-10 bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700" />
              <Th col="team" label="Team" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} className="hidden sm:table-cell" title="NBA team" />
              <Th col="g15" label={`G(${windowDays}d)`} sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} className="hidden sm:table-cell" title={`Games played in the last ${windowDays} days`} />
              <Th col="stat" label="Stat" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} title="Shooting category: 3P%, FT%, or FG%" />
              <Th col="cur" label="Current%" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} title="Shooting % this season to date" />
              <Th col="base" label="Baseline%" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} title="Career shooting % over the prior 2 seasons, attempt-weighted" />
              <Th col="dev" label="Dev vs history (pp)" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} title="Deviation: current% minus baseline%, in percentage points. Negative = cold (buy-low), positive = hot (sell-high)" />
              <Th col="att" label="Att/g" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} className="hidden sm:table-cell" title="Attempts per game this season" />
              <Th col="drift" label="If reverts to baseline" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} title="Expected change if this stat reverts to the player's own baseline %" />
              <th className="px-1.5 sm:px-3 py-2 text-left text-[10px] sm:text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400" title="Fantasy owner, or FA if unrostered">Status</th>
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && <EmptyRow colSpan={10} />}
            {groups.map(({ group, stats }) => (
              stats.map((s, i) => (
                <tr key={`${group.player_name}-${s.stat}`} className={`border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 ${i > 0 ? 'bg-gray-50/50 dark:bg-gray-900/30' : ''}`}>
                  {i === 0 && (
                    <>
                      <td rowSpan={stats.length} className="align-top px-1.5 sm:px-3 py-1.5 sm:py-2 font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap sticky left-0 z-10 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700">{group.player_name}</td>
                      <td rowSpan={stats.length} className="hidden sm:table-cell align-top px-3 py-2 text-gray-500 dark:text-gray-400">{group.pro_team}</td>
                      <td rowSpan={stats.length} className="hidden sm:table-cell align-top px-3 py-2 text-gray-700 dark:text-gray-300">{group.games_last_15d}</td>
                    </>
                  )}
                  <td className={`px-1.5 sm:px-3 py-1.5 sm:py-2 text-gray-700 dark:text-gray-300 ${i > 0 ? 'pl-5' : ''}`}>
                    {i > 0 && <span className="text-gray-400 dark:text-gray-500">↳ </span>}{s.stat}
                  </td>
                  <td className="px-1.5 sm:px-3 py-1.5 sm:py-2 text-gray-700 dark:text-gray-300">{s.current_pct.toFixed(1)}%</td>
                  <td className="px-1.5 sm:px-3 py-1.5 sm:py-2 text-gray-700 dark:text-gray-300">{s.baseline_pct.toFixed(1)}%</td>
                  <td className="px-1.5 sm:px-3 py-1.5 sm:py-2"><DeltaPill value={s.dev} unit="pp" /></td>
                  <td className="hidden sm:table-cell px-3 py-2 text-gray-700 dark:text-gray-300">{s.attempts_per_game.toFixed(1)}</td>
                  <td className="px-1.5 sm:px-3 py-1.5 sm:py-2 text-gray-400 dark:text-gray-500">{expectedDriftText(s)}</td>
                  {i === 0 && <td rowSpan={stats.length} className="align-top px-1.5 sm:px-3 py-1.5 sm:py-2"><StatusBadge fantasyStatus={group.fantasy_status} /></td>}
                </tr>
              ))
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-2">Buy-low = negative dev (cold vs own last-2-season history). Sell-high = positive dev (hot vs own history).</p>
    </div>
  )
}

const WINDOW_OPTIONS = [7, 15, 30] as const

export default function Trends() {
  const [tab, setTab] = useState<TabKey>('minutes')
  const [nameFilter, setNameFilter] = useState('')
  const [position, setPosition] = useState<string | null>(null)
  const [windowDays, setWindowDays] = useState<number>(15)
  const [minGames, setMinGames] = useState(3)

  const minutesQuery = useGetTrendsMinutesQuery({ windowDays }, { skip: tab !== 'minutes' })
  const usageQuery = useGetTrendsUsageQuery({ windowDays }, { skip: tab !== 'usage' })
  const regressionQuery = useGetTrendsRegressionQuery({ windowDays }, { skip: tab !== 'regression' })

  const filters = { nameFilter, position, minG15: minGames }

  const activeQuery = tab === 'minutes' ? minutesQuery : tab === 'usage' ? usageQuery : regressionQuery

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div className="max-w-screen-2xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">📈 Trends</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Whose situation just changed — minutes, usage, shooting regression. Free agents only.</p>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-3 sm:p-4 mb-6 space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden text-xs sm:text-sm">
              {([
                ['minutes', 'Minutes Movers'],
                ['usage', 'Usage & Role'],
                ['regression', 'Shooting Regression'],
              ] as [TabKey, string][]).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`px-3 py-1.5 whitespace-nowrap ${tab === key ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              type="text"
              placeholder="Search player…"
              value={nameFilter}
              onChange={e => setNameFilter(e.target.value)}
              className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm min-w-[150px]"
            />
            <span className="flex-1" />
            <select
              value={position ?? ''}
              onChange={e => setPosition(e.target.value || null)}
              className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
            >
              <option value="">All positions</option>
              {ALL_POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden text-xs sm:text-sm" title="Recency window for the G column and eligibility filter">
              {WINDOW_OPTIONS.map(d => (
                <button
                  key={d}
                  onClick={() => setWindowDays(d)}
                  className={`px-2.5 py-1.5 whitespace-nowrap ${windowDays === d ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200'}`}
                >
                  {d}d
                </button>
              ))}
            </div>
            <label className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-gray-600 dark:text-gray-300">
              Min games
              <input
                type="number"
                min={0}
                value={minGames}
                onChange={e => setMinGames(Math.max(0, Number(e.target.value)))}
                title={`Minimum games played in the last ${windowDays} days`}
                className="w-16 px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
              />
            </label>
          </div>

          {activeQuery.isLoading && <LoadingSpinner />}
          {activeQuery.error && <ErrorMessage message="Failed to load trends data." />}

          {!activeQuery.isLoading && !activeQuery.error && (
            <>
              {tab === 'minutes' && minutesQuery.data && <MinutesTable items={minutesQuery.data.items} filters={filters} windowDays={windowDays} />}
              {tab === 'usage' && usageQuery.data && <UsageTable items={usageQuery.data.items} filters={filters} windowDays={windowDays} />}
              {tab === 'regression' && regressionQuery.data && <RegressionTable items={regressionQuery.data.items} filters={filters} windowDays={windowDays} />}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

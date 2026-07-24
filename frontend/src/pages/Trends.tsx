import { Fragment, useMemo, useState } from 'react'
import {
  useGetTrendsMinutesQuery,
  useGetTrendsUsageQuery,
  useGetTrendsRegressionQuery,
} from '../store/api/fantasyApi'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import TrendGameLogChart from '../components/TrendGameLogChart'
import { BASELINE_LABEL } from '../utils/trendBaseline'
import type { MinutesMoverItem, UsageRoleItem, RegressionPlayerGroup, RegressionStatItem, RegressionStat, RegressionMode } from '../types/api'

type TabKey = 'minutes' | 'usage' | 'shooting-season' | 'shooting-form'
type Ownership = 'all' | 'fa' | 'rostered'

const TABS: [TabKey, string, string][] = [
  ['minutes', 'Minutes Movers', 'Who is playing more or fewer minutes than their season average'],
  ['usage', 'Usage & Role', 'Whose share of their team’s possessions has moved'],
  ['shooting-season', 'Shooting · Season', "Whose season shooting line is out of step with their history — the number that will look different by the time you trade them."],
  ['shooting-form', 'Shooting · Form', "Who is genuinely shooting above or below their own level right now, judged against everything outside the recency window. Small samples are filtered out by significance, not by a fixed attempt count."],
]

const TAB_MODE: Partial<Record<TabKey, RegressionMode>> = {
  'shooting-season': 'season',
  'shooting-form': 'form',
}

const ALL_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C']

const BASELINE_OPTIONS: [number, string, string][] = [
  [2, 'Prior 2 seasons', 'This season measured against the two seasons before it, attempt-weighted. Bigger sample, survives one fluky year, but slow to accept a genuine change in the shooter.'],
  [1, 'Last season only', 'This season measured against last season alone. Reacts faster to a real change, noisier for low-volume shooters.'],
]

const OWNERSHIP_OPTIONS: [Ownership, string][] = [
  ['all', 'All players'],
  ['fa', 'Free agents'],
  ['rostered', 'Rostered'],
]

interface Filters {
  nameFilter: string
  position: string | null
  minG15: number
  ownership: Ownership
  fantasyTeam: string | null
}

interface SharedFilterable {
  player_name: string
  position: string
  fantasy_status: string
  games_last_15d: number
}

function passesShared<T extends SharedFilterable>(
  row: T,
  { nameFilter, position, minG15, ownership, fantasyTeam }: Filters
): boolean {
  if (position && row.position !== position) return false
  if (row.games_last_15d < minG15) return false
  if (ownership === 'fa' && row.fantasy_status !== 'FA') return false
  if (ownership === 'rostered' && row.fantasy_status === 'FA') return false
  if (fantasyTeam && row.fantasy_status !== fantasyTeam) return false
  if (nameFilter.trim() && !row.player_name.toLowerCase().includes(nameFilter.trim().toLowerCase())) return false
  return true
}

function ExpandRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr className="bg-gray-50/70 dark:bg-gray-900/40 border-b border-gray-200 dark:border-gray-700">
      <td colSpan={colSpan} className="p-0">
        {/* sticky-left so the chart stays on screen however far the table is scrolled */}
        <div className="sticky left-0 px-2 sm:px-4 py-3" style={{ width: 'min(100%, calc(100vw - 3.5rem))' }}>{children}</div>
      </td>
    </tr>
  )
}

function useExpandedSet() {
  const [open, setOpen] = useState<Set<number>>(new Set())
  const toggle = (id: number) => setOpen(prev => {
    const next = new Set(prev)
    if (!next.delete(id)) next.add(id)
    return next
  })
  return { open, toggle }
}

function Caret({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 8 10"
      aria-hidden="true"
      className={`inline-block w-2 h-2.5 mr-1.5 align-[-1px] transition-transform ${open ? 'rotate-90 text-blue-500' : 'text-gray-400 dark:text-gray-500'}`}
    >
      <path d="M0 0 L8 5 L0 10 Z" fill="currentColor" />
    </svg>
  )
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

function MinutesTable({ items, filters, windowDays }: { items: MinutesMoverItem[]; filters: Filters; windowDays: number }) {
  const [sortCol, setSortCol] = useState('delta')
  const [sortAsc, setSortAsc] = useState(false)
  const { open: expanded, toggle } = useExpandedSet()

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
            <Th col="delta" label="Δ MPG vs season" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} title={`Change: ${windowDays}d MPG minus season MPG`} />
            <Th col="gp" label="GP" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} className="hidden sm:table-cell" title="Games played this season" />
            <Th col="g15" label={`G(${windowDays}d)`} sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} className="hidden sm:table-cell" title={`Games played in the last ${windowDays} days`} />
            <th className="px-1.5 sm:px-3 py-2 text-left text-[10px] sm:text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400" title="Fantasy owner, or FA if unrostered">Owner</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <EmptyRow colSpan={9} />}
          {rows.map(r => {
            const open = expanded.has(r.player_id)
            return (
            <Fragment key={r.player_id}>
            <tr
              onClick={() => toggle(r.player_id)}
              tabIndex={0}
              role="button"
              aria-expanded={open}
              onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && toggle(r.player_id)}
              className="group cursor-pointer border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50"
            >
              <td className="px-1.5 sm:px-3 py-1.5 sm:py-2 font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap sticky left-0 z-10 bg-white dark:bg-gray-800 group-hover:bg-gray-50 dark:group-hover:bg-gray-700/50 border-r border-gray-200 dark:border-gray-700">
                <Caret open={open} />
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
            {open && (
              <ExpandRow colSpan={9}>
                <TrendGameLogChart playerId={r.player_id} playerName={r.player_name} mode="minutes" windowDays={windowDays} />
              </ExpandRow>
            )}
            </Fragment>
          )})}
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

function UsageTable({ items, filters, windowDays }: { items: UsageRoleItem[]; filters: Filters; windowDays: number }) {
  const [sortCol, setSortCol] = useState('delta')
  const [sortAsc, setSortAsc] = useState(false)
  const { open: expanded, toggle } = useExpandedSet()

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
        <b>Usage ↑/↓</b> = usage moved on flat minutes. Δ USG / Δ MPG columns show the raw numbers behind each label. Click any row for the game-by-game chart.
      </p>
      <div className="overflow-x-auto rounded-lg">
        <table className="w-full text-xs sm:text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
              <Th col="player" label="Player" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} className="sticky left-0 z-10 bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700" />
              <Th col="team" label="Team" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} className="hidden sm:table-cell" title="NBA team" />
              <Th col="season" label="Season USG%" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} title="Usage rate (% of team plays used by this player while on court), full season" />
              <Th col="l5" label={`${windowDays}d USG%`} sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} title={`Usage rate over the last ${windowDays} days`} />
              <Th col="delta" label="Δ USG vs season" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} title={`Change: ${windowDays}d usage rate minus season usage rate, in percentage points (not a relative change)`} />
              <Th col="dmpg" label="Δ MPG" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} className="hidden sm:table-cell" title={`Change: ${windowDays}d MPG minus season MPG`} />
              <Th col="g15" label={`G(${windowDays}d)`} sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} className="hidden sm:table-cell" title={`Games played in the last ${windowDays} days`} />
              <th className="px-1.5 sm:px-3 py-2 text-left text-[10px] sm:text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400" title="Role change label based on ΔUSG and ΔMPG thresholds — see note above">Role</th>
              <th className="px-1.5 sm:px-3 py-2 text-left text-[10px] sm:text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400" title="Fantasy owner, or FA if unrostered">Owner</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={9} />}
            {rows.map(r => {
              const open = expanded.has(r.player_id)
              return (
              <Fragment key={r.player_id}>
              <tr
                onClick={() => toggle(r.player_id)}
                tabIndex={0}
                role="button"
                aria-expanded={open}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && toggle(r.player_id)}
                className="group cursor-pointer border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50"
              >
                <td className="px-1.5 sm:px-3 py-1.5 sm:py-2 font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap sticky left-0 z-10 bg-white dark:bg-gray-800 group-hover:bg-gray-50 dark:group-hover:bg-gray-700/50 border-r border-gray-200 dark:border-gray-700"><Caret open={open} />{r.player_name}</td>
                <td className="hidden sm:table-cell px-3 py-2 text-gray-500 dark:text-gray-400">{r.pro_team}</td>
                <td className="px-1.5 sm:px-3 py-1.5 sm:py-2 text-gray-700 dark:text-gray-300">{r.season_usg.toFixed(1)}%</td>
                <td className="px-1.5 sm:px-3 py-1.5 sm:py-2 text-gray-700 dark:text-gray-300">{r.l5_usg.toFixed(1)}%</td>
                <td className="px-1.5 sm:px-3 py-1.5 sm:py-2"><DeltaPill value={r.delta_usg} unit="%" /></td>
                <td className="hidden sm:table-cell px-3 py-2 text-gray-700 dark:text-gray-300">{r.delta_mpg >= 0 ? '+' : ''}{r.delta_mpg.toFixed(1)}mpg</td>
                <td className="hidden sm:table-cell px-3 py-2 text-gray-700 dark:text-gray-300">{r.games_last_15d}</td>
                <td className="px-1.5 sm:px-3 py-1.5 sm:py-2"><RoleBadge badge={r.role_badge} /></td>
                <td className="px-1.5 sm:px-3 py-1.5 sm:py-2"><StatusBadge fantasyStatus={r.fantasy_status} /></td>
              </tr>
              {open && (
                <ExpandRow colSpan={9}>
                  <TrendGameLogChart playerId={r.player_id} playerName={r.player_name} mode="usage" windowDays={windowDays} />
                </ExpandRow>
              )}
              </Fragment>
            )})}
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
  z: s => Math.abs(s.z ?? 0),  // magnitude, so an ice-cold stretch ranks with a red-hot one
  impact: s => normalizeDelta(s),
}

const MAKES_LABEL: Record<RegressionStat, string> = { '3P%': '3PM', 'FT%': 'FTM', 'FG%': 'FGM' }

// Expected change in makes per game if the stat snaps back to the baseline, at
// current attempt volume — same unit for all three stats so they compare.
function normalizeDelta(stat: RegressionStatItem): number {
  return (-stat.dev / 100) * stat.attempts_per_game
}

function NormalizePill({ stat }: { stat: RegressionStatItem }) {
  const delta = normalizeDelta(stat)
  return (
    <span className={`whitespace-nowrap ${delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
      {delta >= 0 ? '+' : ''}{delta.toFixed(2)} {MAKES_LABEL[stat.stat]}/g
    </span>
  )
}

function ZCell({ z }: { z: number | null }) {
  if (z === null) return <span className="text-gray-400 dark:text-gray-500">—</span>
  return (
    <span className="whitespace-nowrap text-gray-700 dark:text-gray-300 tabular-nums">
      {z >= 0 ? '+' : ''}{z.toFixed(2)}
    </span>
  )
}

function RegressionTable({ items, filters, windowDays, baselineSeasons, mode }: { items: RegressionPlayerGroup[]; filters: Filters; windowDays: number; baselineSeasons: number; mode: RegressionMode }) {
  const isForm = mode === 'form'
  const colCount = isForm ? 11 : 10
  const [sortCol, setSortCol] = useState(isForm ? 'z' : 'dev')
  const [sortAsc, setSortAsc] = useState(false)
  const [statFilter, setStatFilter] = useState<'all' | '3P%' | 'FT%' | 'FG%'>('all')
  const [expanded, setExpanded] = useState<Record<number, RegressionStat>>({})

  const toggleStat = (playerId: number, stat: RegressionStat) => setExpanded(prev => {
    const next = { ...prev }
    if (next[playerId] === stat) delete next[playerId]
    else next[playerId] = stat
    return next
  })

  const groups = useMemo(() => {
    const filtered = items
      .filter(g => passesShared(g, filters))
      .map(g => ({ ...g, stats: statFilter === 'all' ? g.stats : g.stats.filter(s => s.stat === statFilter) }))
      .filter(g => g.stats.length > 0)

    const getVal = REG_SORT_VAL[sortCol] ?? REG_SORT_VAL.dev
    const identityCol = sortCol === 'stat' ? false : ['player', 'team', 'g15'].includes(sortCol)

    const withKey = filtered.map(g => {
      const sortedStats = [...g.stats].sort((a, b) => (
        isForm ? b.drift_score - a.drift_score : Math.abs(b.dev) - Math.abs(a.dev)
      ))
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
  }, [items, filters, statFilter, sortCol, sortAsc, isForm])

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
        {isForm
          ? `Filter: at least 10 attempts in the last ${windowDays} days, 50 in the baseline, and a gap of at least 1.5 standard errors — so a hot night on thin volume never lists. Ranked by z: the least likely to be luck first.`
          : 'Filter: fantasy-relevant swing ≥ 0.35 makes/g-equivalent (attempts/g × |dev|), volume-weighted. Grouped by player: worst-offending stat surfaces first.'}
      </p>
      <div className="overflow-x-auto rounded-lg">
        <table className="w-full text-xs sm:text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
              <Th col="player" label="Player" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} className="sticky left-0 z-10 bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700" />
              <Th col="team" label="Team" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} className="hidden sm:table-cell" title="NBA team" />
              <Th col="g15" label={`G(${windowDays}d)`} sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} className="hidden sm:table-cell" title={`Games played in the last ${windowDays} days`} />
              <Th col="stat" label="Stat" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} title="Shooting category: 3P%, FT%, or FG%" />
              {isForm ? (
                <>
                  <Th col="cur" label={`Last ${windowDays}d %`} sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} title={`Shooting % over the last ${windowDays} days only — the stretch being judged.`} />
                  <Th col="base" label="Baseline %" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} title={`What he normally shoots: the ${BASELINE_LABEL[baselineSeasons]} before this one pooled with this season up to the last ${windowDays} days. Excludes the window itself.`} />
                  <Th col="dev" label="Gap" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} title="Last-window % minus baseline %, in percentage points. Negative = ice cold right now, positive = red hot." />
                  <Th col="z" label="z" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} title="How many standard errors the gap sits from zero. Above 1.5 is more than the sample size alone would produce — the bigger the number, the less likely it is luck. Sorts by size, so hot and cold rank together; sort by Gap to separate them." />
                  <Th col="att" label="Att/g" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} className="hidden sm:table-cell" title={`Attempts per game over the last ${windowDays} days`} />
                  <Th col="impact" label="If it normalizes" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} title="Expected change in makes per game going forward if he returns to his baseline %, at his current attempt volume" />
                </>
              ) : (
                <>
                  <Th col="cur" label="Season%" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} title="Shooting % across the whole season to date. This is the number compared against the baseline." />
                  <Th col="base" label={`Baseline (${BASELINE_LABEL[baselineSeasons]})`} sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} title={`Attempt-weighted shooting % over the ${BASELINE_LABEL[baselineSeasons]} before this one. Excludes this season.`} />
                  <Th col="dev" label="Δ vs baseline" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} title="Current% minus baseline%, in percentage points (not a relative change). Negative = cold (buy-low), positive = hot (sell-high)" />
                  <Th col="att" label="Att/g" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} className="hidden sm:table-cell" title="Attempts per game this season" />
                  <Th col="drift" label="If it normalizes" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} title="Expected change in makes per game if this stat returns to the player's baseline %, at current attempt volume" />
                </>
              )}
              <th className="px-1.5 sm:px-3 py-2 text-left text-[10px] sm:text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400" title="Fantasy owner, or FA if unrostered">Owner</th>
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && <EmptyRow colSpan={colCount} />}
            {groups.map(({ group, stats }) => {
              const openStat = expanded[group.player_id]
              const toggle = (stat: RegressionStat) => toggleStat(group.player_id, stat)
              return (
              <Fragment key={group.player_id}>
              {stats.map((s, i) => {
                const active = openStat === s.stat
                return (
                <tr
                  key={`${group.player_id}-${s.stat}`}
                  onClick={() => toggle(s.stat)}
                  tabIndex={0}
                  role="button"
                  aria-expanded={active}
                  onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && toggle(s.stat)}
                  className={`cursor-pointer border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 ${active ? 'bg-blue-50 dark:bg-blue-900/20' : i > 0 ? 'bg-gray-50/50 dark:bg-gray-900/30' : ''}`}
                >
                  {i === 0 && (
                    <>
                      <td rowSpan={stats.length} className="align-top px-1.5 sm:px-3 py-1.5 sm:py-2 font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap sticky left-0 z-10 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700">
                        <Caret open={openStat !== undefined} />{group.player_name}
                      </td>
                      <td rowSpan={stats.length} className="hidden sm:table-cell align-top px-3 py-2 text-gray-500 dark:text-gray-400">{group.pro_team}</td>
                      <td rowSpan={stats.length} className="hidden sm:table-cell align-top px-3 py-2 text-gray-700 dark:text-gray-300">{group.games_last_15d}</td>
                    </>
                  )}
                  <td className={`px-1.5 sm:px-3 py-1.5 sm:py-2 text-gray-700 dark:text-gray-300 ${i > 0 ? 'pl-5' : ''}`}>
                    {i > 0 && <span className="text-gray-400 dark:text-gray-500">↳ </span>}{s.stat}
                  </td>
                  <td className="px-1.5 sm:px-3 py-1.5 sm:py-2 text-gray-700 dark:text-gray-300">{s.current_pct.toFixed(1)}%</td>
                  <td className="px-1.5 sm:px-3 py-1.5 sm:py-2 text-gray-700 dark:text-gray-300">{s.baseline_pct.toFixed(1)}%</td>
                  <td className="px-1.5 sm:px-3 py-1.5 sm:py-2"><DeltaPill value={s.dev} unit="%" /></td>
                  {isForm && <td className="px-1.5 sm:px-3 py-1.5 sm:py-2"><ZCell z={s.z} /></td>}
                  <td className="hidden sm:table-cell px-3 py-2 text-gray-700 dark:text-gray-300">{s.attempts_per_game.toFixed(1)}</td>
                  <td className="px-1.5 sm:px-3 py-1.5 sm:py-2"><NormalizePill stat={s} /></td>
                  {i === 0 && <td rowSpan={stats.length} className="align-top px-1.5 sm:px-3 py-1.5 sm:py-2"><StatusBadge fantasyStatus={group.fantasy_status} /></td>}
                </tr>
              )})}
              {openStat !== undefined && (
                <ExpandRow colSpan={colCount}>
                  <TrendGameLogChart
                    playerId={group.player_id}
                    playerName={group.player_name}
                    mode="shooting"
                    regressionMode={mode}
                    windowDays={windowDays}
                    baselineSeasons={baselineSeasons}
                    stat={openStat}
                    qualifiedStats={stats.map(s => s.stat)}
                    onStatChange={stat => setExpanded(prev => ({ ...prev, [group.player_id]: stat }))}
                  />
                </ExpandRow>
              )}
              </Fragment>
            )})}
          </tbody>
        </table>
      </div>
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
  const [ownership, setOwnership] = useState<Ownership>('all')
  const [fantasyTeam, setFantasyTeam] = useState<string | null>(null)
  const [baselineSeasons, setBaselineSeasons] = useState(2)

  const regressionMode = TAB_MODE[tab]
  const isShooting = regressionMode !== undefined

  const minutesQuery = useGetTrendsMinutesQuery({ windowDays }, { skip: tab !== 'minutes' })
  const usageQuery = useGetTrendsUsageQuery({ windowDays }, { skip: tab !== 'usage' })
  const regressionQuery = useGetTrendsRegressionQuery(
    { windowDays, baselineSeasons, mode: regressionMode ?? 'season' },
    { skip: !isShooting },
  )

  const filters: Filters = { nameFilter, position, minG15: minGames, ownership, fantasyTeam }

  const activeQuery = tab === 'minutes' ? minutesQuery : tab === 'usage' ? usageQuery : regressionQuery

  const teamOptions = useMemo(() => {
    const items = minutesQuery.data?.items ?? usageQuery.data?.items ?? regressionQuery.data?.items ?? []
    return [...new Set(items.map(i => i.fantasy_status).filter(t => t !== 'FA'))].sort()
  }, [minutesQuery.data, usageQuery.data, regressionQuery.data])

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div className="max-w-screen-2xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">📈 Trends</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Whose situation just changed — minutes, usage, shooting. Click any player for their game-by-game chart.</p>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-3 sm:p-4 mb-6 space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            {/* four tabs overflow one row at 390px, so mobile gets a 2x2 grid */}
            <div className="grid grid-cols-2 sm:flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden text-xs sm:text-sm">
              {TABS.map(([key, label, help]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  title={help}
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
            <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden text-xs sm:text-sm" title="Which players to show: everyone, free agents only, or rostered only">
              {OWNERSHIP_OPTIONS.map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => { setOwnership(key); if (key === 'fa') setFantasyTeam(null) }}
                  className={`px-2.5 py-1.5 whitespace-nowrap ${ownership === key ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <select
              value={fantasyTeam ?? ''}
              onChange={e => { setFantasyTeam(e.target.value || null); if (e.target.value) setOwnership('all') }}
              title="Show only players on one fantasy team"
              className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm max-w-[170px]"
            >
              <option value="">All fantasy teams</option>
              {teamOptions.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            {isShooting && (
              <label className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-gray-600 dark:text-gray-300" title="This season's shooting is always what gets measured (the Current% column). This picks the past period it is measured against.">
              Compare this season to
              <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden text-xs sm:text-sm">
                {BASELINE_OPTIONS.map(([value, label, help]) => (
                  <button
                    key={value}
                    onClick={() => setBaselineSeasons(value)}
                    title={help}
                    className={`px-2.5 py-1.5 whitespace-nowrap ${baselineSeasons === value ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              </label>
            )}
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
              {isShooting && regressionQuery.data && (
                <RegressionTable
                  key={regressionQuery.data.mode}
                  items={regressionQuery.data.items}
                  filters={filters}
                  windowDays={windowDays}
                  baselineSeasons={regressionQuery.data.baseline_seasons}
                  mode={regressionQuery.data.mode}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

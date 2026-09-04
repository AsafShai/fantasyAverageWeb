import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AdpPlayer } from '../../types/api'
import { useIsBelowLg } from '../../hooks/useIsBelowLg'
import { draftTeamColor } from '../../utils/adp'
import { teamLabel, type MockSession } from '../../utils/mockDraft'
import {
  STANDING_CATS,
  buildProjectedStandings,
  calcByOptions,
  clampCalcBy,
  formatCalcByLabel,
  formatRotoPoints,
  formatStandingValue,
  normalizeColumn,
  type StandingCatKey,
  type StandingsMode,
  type StatsFrom,
} from '../../utils/mockProjectedStandings'
import { getHeatmapColor, getTextColor } from '../../utils/colorUtils'

const TEAM_COL = '4.75rem'
const TOTAL_COL = '3.25rem'

function useDarkMode() {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    const obs = new MutationObserver(() => setIsDark(document.documentElement.classList.contains('dark')))
    obs.observe(document.documentElement, { attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])
  return isDark
}

function SegGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </div>
      <div className="grid grid-cols-2 rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden">
        {children}
      </div>
    </div>
  )
}

function SegBtn({
  active,
  onClick,
  children,
  ariaLabel,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
  ariaLabel?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={`min-h-11 lg:min-h-9 px-1.5 sm:px-2 text-xs font-semibold ${
        active
          ? 'bg-blue-600 text-white'
          : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300'
      }`}
    >
      {children}
    </button>
  )
}

type SortKey = 'team' | 'total' | StandingCatKey
type SortDir = 'asc' | 'desc'

function sortValue(
  row: {
    team: number
    rank: number
    totalPoints: number
    values: Record<StandingCatKey, number | null>
    points: Record<StandingCatKey, number>
  },
  key: SortKey,
  show: 'stats' | 'rankings',
): number | null {
  if (key === 'team') return row.rank
  if (key === 'total') return row.totalPoints
  return show === 'rankings' ? row.points[key] : row.values[key]
}

function compareSortValues(a: number | null, b: number | null, dir: SortDir): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  return dir === 'asc' ? a - b : b - a
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
  align = 'center',
  pin,
}: {
  label: string
  active: boolean
  dir: SortDir
  onClick: () => void
  align?: 'left' | 'center'
  pin?: 'team' | 'total'
}) {
  const pinClass =
    pin === 'team'
      ? 'sticky left-0 z-30 bg-gray-50 dark:bg-gray-800'
      : pin === 'total'
        ? 'sticky z-20 bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-100 max-lg:shadow-[2px_0_6px_-2px_rgba(0,0,0,0.18)] lg:static'
        : ''
  return (
    <th
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`p-0 font-semibold whitespace-nowrap ${pinClass}`}
      style={
        pin === 'team'
          ? { minWidth: TEAM_COL, width: TEAM_COL, left: 0 }
          : pin === 'total'
            ? { minWidth: TOTAL_COL, width: TOTAL_COL, left: TEAM_COL }
            : undefined
      }
    >
      <button
        type="button"
        onClick={onClick}
        className={`w-full min-h-11 lg:min-h-9 px-1.5 lg:px-2 py-2 inline-flex items-center gap-0.5 uppercase hover:text-gray-800 dark:hover:text-gray-200 ${
          align === 'left' ? 'justify-start px-2' : 'justify-center text-center'
        }`}
      >
        {label}
        <span aria-hidden className={active ? 'visible' : 'invisible'}>
          {dir === 'asc' ? '↑' : '↓'}
        </span>
      </button>
    </th>
  )
}

export function MockProjectedStandings({
  session,
  detailsById,
  statsFrom,
  onStatsFrom,
}: {
  session: MockSession
  detailsById: Map<string, AdpPlayer>
  statsFrom: StatsFrom
  onStatsFrom: (value: StatsFrom) => void
}) {
  const isDark = useDarkMode()
  const isMobile = useIsBelowLg()
  const [mode, setMode] = useState<StandingsMode>('averages')
  const [show, setShow] = useState<'stats' | 'rankings'>('rankings')
  const [sortBy, setSortBy] = useState<SortKey>('total')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [topN, setTopN] = useState(() => session.rounds)
  const options = calcByOptions(session.rounds)
  const resolvedTopN = clampCalcBy(topN, session.rounds)

  const rows = useMemo(
    () =>
      buildProjectedStandings({
        session,
        detailsById,
        statsFrom,
        mode,
        topN: resolvedTopN,
      }),
    [session, detailsById, statsFrom, mode, resolvedTopN],
  )

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const cmp = compareSortValues(sortValue(a, sortBy, show), sortValue(b, sortBy, show), sortDir)
      return cmp || a.team - b.team
    })
  }, [rows, sortBy, sortDir, show])

  const heat = useMemo(() => {
    const byCat = Object.fromEntries(
      STANDING_CATS.map((cat) => [
        cat.key,
        normalizeColumn(
          sortedRows.map((row) => (show === 'rankings' ? row.points[cat.key] : row.values[cat.key])),
        ),
      ]),
    ) as Record<StandingCatKey, number[]>
    return {
      cats: byCat,
      total: normalizeColumn(sortedRows.map((row) => row.totalPoints)),
    }
  }, [sortedRows, show])

  const handleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortBy(key)
    setSortDir(key === 'team' ? 'asc' : 'desc')
  }

  if (session.picks.length === 0) {
    return (
      <div className="px-4 py-10 text-sm text-gray-500 dark:text-gray-400 text-center">
        Projected standings appear after the first pick.
      </div>
    )
  }

  const bumpTopN = (delta: number) => {
    const idx = options.indexOf(resolvedTopN)
    const next = options[Math.min(options.length - 1, Math.max(0, idx + delta))]
    if (next != null) setTopN(next)
  }

  return (
    <div className="flex flex-col min-w-0 min-h-0 flex-1">
      <div className="shrink-0 flex flex-col gap-3 px-3 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
          <SegGroup label="Split">
            <SegBtn active={mode === 'averages'} onClick={() => setMode('averages')} ariaLabel="Averages">
              {isMobile ? 'Avg' : 'Averages'}
            </SegBtn>
            <SegBtn active={mode === 'totals'} onClick={() => setMode('totals')} ariaLabel="Totals">
              {isMobile ? 'Tot' : 'Totals'}
            </SegBtn>
          </SegGroup>
          <SegGroup label="Season">
            <SegBtn active={statsFrom === 'actual'} onClick={() => onStatsFrom('actual')} ariaLabel="Last year">
              {isMobile ? 'Last' : 'Last year'}
            </SegBtn>
            <SegBtn active={statsFrom === 'projection'} onClick={() => onStatsFrom('projection')} ariaLabel="Projected">
              {isMobile ? 'Proj' : 'Projected'}
            </SegBtn>
          </SegGroup>
          <SegGroup label="Show">
            <SegBtn active={show === 'rankings'} onClick={() => setShow('rankings')} ariaLabel="Rankings">
              {isMobile ? 'Rank' : 'Rankings'}
            </SegBtn>
            <SegBtn active={show === 'stats'} onClick={() => setShow('stats')}>
              Stats
            </SegBtn>
          </SegGroup>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Calculate by
          </span>
          <button
            type="button"
            onClick={() => bumpTopN(-1)}
            disabled={resolvedTopN <= options[0]}
            className="min-h-11 min-w-11 lg:min-h-9 lg:min-w-9 rounded-md border border-gray-300 dark:border-gray-600 text-base font-bold text-gray-700 dark:text-gray-200 disabled:opacity-40"
            aria-label="Fewer picks"
          >
            −
          </button>
          <span className="text-sm font-semibold tabular-nums text-gray-800 dark:text-gray-100">
            {formatCalcByLabel(resolvedTopN, session.rounds)}
          </span>
          <button
            type="button"
            onClick={() => bumpTopN(1)}
            disabled={resolvedTopN >= options[options.length - 1]}
            className="min-h-11 min-w-11 lg:min-h-9 lg:min-w-9 rounded-md border border-gray-300 dark:border-gray-600 text-base font-bold text-gray-700 dark:text-gray-200 disabled:opacity-40"
            aria-label="More picks"
          >
            +
          </button>
        </div>
      </div>

      {isMobile ? (
        <p className="shrink-0 px-3 py-1.5 text-[11px] text-gray-500 dark:text-gray-400">
          Swipe for categories · tap a header to sort
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto overscroll-x-contain">
        <table className="text-sm border-separate border-spacing-0">
          <thead className="bg-gray-50 dark:bg-gray-800 text-[10px] uppercase text-gray-500 dark:text-gray-400 sticky top-0 z-40">
            <tr>
              <SortHeader
                label="Team"
                active={sortBy === 'team'}
                dir={sortDir}
                align="left"
                pin="team"
                onClick={() => handleSort('team')}
              />
              {isMobile ? (
                <SortHeader
                  label="Tot"
                  active={sortBy === 'total'}
                  dir={sortDir}
                  pin="total"
                  onClick={() => handleSort('total')}
                />
              ) : null}
              {STANDING_CATS.map((cat) => (
                <SortHeader
                  key={cat.key}
                  label={cat.label}
                  active={sortBy === cat.key}
                  dir={sortDir}
                  onClick={() => handleSort(cat.key)}
                />
              ))}
              {!isMobile ? (
                <SortHeader
                  label="Total"
                  active={sortBy === 'total'}
                  dir={sortDir}
                  pin="total"
                  onClick={() => handleSort('total')}
                />
              ) : null}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, rowIndex) => {
              const isYou = row.team === session.userTeam
              const name = isMobile
                ? isYou
                  ? 'You'
                  : `T${row.team}`
                : teamLabel(row.team, session.userTeam)
              const youEdge = isDark ? '#93c5fd' : '#2563eb'
              const youBar = isYou ? `inset 0 2px 0 0 ${youEdge}, inset 0 -2px 0 0 ${youEdge}` : undefined
              const totalFrame = isDark
                ? 'inset 2px 0 0 0 rgba(147,197,253,0.55), inset -2px 0 0 0 rgba(147,197,253,0.55)'
                : 'inset 2px 0 0 0 rgba(37,99,235,0.35), inset -2px 0 0 0 rgba(37,99,235,0.35)'
              return (
                <tr key={row.team} data-user-row={isYou ? 'true' : undefined}>
                  <td
                    className={`px-2 py-2.5 whitespace-nowrap sticky left-0 z-30 text-xs ${
                      isYou
                        ? 'font-extrabold text-blue-800 dark:text-blue-100 bg-blue-100 dark:bg-blue-900'
                        : 'font-medium text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-900'
                    }`}
                    style={{
                      minWidth: TEAM_COL,
                      width: TEAM_COL,
                      boxShadow: isYou
                        ? `${youBar}, inset 3px 0 0 0 ${youEdge}`
                        : undefined,
                    }}
                  >
                    <span className="inline-flex items-center gap-1.5 min-w-0">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: draftTeamColor(row.team - 1) }}
                      />
                      <span className="truncate">
                        {row.rank}. {name}
                      </span>
                    </span>
                  </td>
                  {isMobile ? (
                    <td
                      className="px-1.5 py-2.5 text-center tabular-nums text-xs font-extrabold whitespace-nowrap sticky z-20"
                      style={{
                        minWidth: TOTAL_COL,
                        width: TOTAL_COL,
                        left: TEAM_COL,
                        backgroundColor: getHeatmapColor(heat.total[rowIndex] ?? 0.5, isDark),
                        color: getTextColor(heat.total[rowIndex] ?? 0.5, isDark),
                        boxShadow: [totalFrame, youBar, '2px 0 6px -2px rgba(0,0,0,0.18)']
                          .filter(Boolean)
                          .join(', '),
                      }}
                    >
                      {formatRotoPoints(row.totalPoints)}
                    </td>
                  ) : null}
                  {STANDING_CATS.map((cat) => {
                    const heatVal = heat.cats[cat.key][rowIndex] ?? 0
                    const raw = row.values[cat.key]
                    const points = row.points[cat.key]
                    return (
                      <td
                        key={cat.key}
                        className="px-2 py-2.5 text-center tabular-nums text-xs font-semibold whitespace-nowrap"
                        style={{
                          backgroundColor: getHeatmapColor(heatVal, isDark),
                          color: getTextColor(heatVal, isDark),
                          minWidth: '3.25rem',
                          boxShadow: isYou ? youBar : undefined,
                        }}
                      >
                        {show === 'rankings'
                          ? formatRotoPoints(points)
                          : formatStandingValue(cat.key, raw, 'pct' in cat)}
                      </td>
                    )
                  })}
                  {!isMobile ? (
                    <td
                      className="px-1.5 py-2.5 text-center tabular-nums text-xs font-extrabold whitespace-nowrap"
                      style={{
                        minWidth: TOTAL_COL,
                        width: TOTAL_COL,
                        backgroundColor: getHeatmapColor(heat.total[rowIndex] ?? 0.5, isDark),
                        color: getTextColor(heat.total[rowIndex] ?? 0.5, isDark),
                        boxShadow: [totalFrame, youBar, isYou ? `inset -3px 0 0 0 ${youEdge}` : null]
                          .filter(Boolean)
                          .join(', '),
                      }}
                    >
                      {formatRotoPoints(row.totalPoints)}
                    </td>
                  ) : null}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

import { useMemo, useState } from 'react'
import { usePersistedState } from '../hooks/usePersistedState'
import {
  useGetAllPlayersQuery,
  useGetDraftReportQuery,
  useGetLeagueActivityQuery,
} from '../store/api/fantasyApi'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import PlayerNameLink from '../components/PlayerNameLink'
import { getErrorMessage } from '../utils/errorMessage'
import { REPORT_MIN_GP } from '../utils/draftReport'
import {
  buildFaReportRows,
  FA_REPORT_MAX_SEASON_RANK,
  FA_REPORT_STATUS_FREE_AGENT,
  FA_REPORT_STATUS_ON_TEAM,
  faReportCurrentStatus,
  formatFaPickupDate,
  type FaReportRow,
} from '../utils/faReport'
import { fantasyTeamOptionLabel } from '../myTeam/display'
import { useMyTeam } from '../context/MyTeamContext'
import { useMobileRedesign } from '../mobile/flag'
import MobileFaReport from '../mobile/draft/MobileFaReport'

type SortCol = 'player' | 'lastFa' | 'faTeam' | 'status' | 'zTotal' | 'valueRank' | 'gp'

export default function FaReport() {
  const [calcMode, setCalcMode] = usePersistedState<'totals' | 'per_game'>('faReport.calcMode', 'per_game')
  const [search, setSearch] = useState('')
  const [sortCol, setSortCol] = useState<SortCol>('valueRank')
  const [sortAsc, setSortAsc] = useState(true)

  const { data: draftReport, isLoading: draftLoading, error: draftError } = useGetDraftReportQuery()
  const { data: playersData, isLoading: poolLoading, error: poolError } = useGetAllPlayersQuery({
    limit: 1200,
    time_period: 'season',
  })
  const { data: activity, error: activityError } = useGetLeagueActivityQuery()

  const { isMyTeam } = useMyTeam()
  const mobileRedesign = useMobileRedesign()

  const rows = useMemo(() => {
    if (!draftReport || !playersData) return []
    return buildFaReportRows(draftReport.picks, playersData.players, activity, calcMode).filter(
      r => r.valueRank !== null && r.valueRank <= FA_REPORT_MAX_SEASON_RANK,
    )
  }, [draftReport, playersData, activity, calcMode])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r => r.player_name.toLowerCase().includes(q) || r.pro_team.toLowerCase().includes(q))
  }, [rows, search])

  const sorted = useMemo(() => {
    const list = [...filtered]
    const cmp = (a: FaReportRow, b: FaReportRow): number => {
      switch (sortCol) {
        case 'player':
          return a.player_name.localeCompare(b.player_name)
        case 'status':
          return faReportCurrentStatus(a).localeCompare(faReportCurrentStatus(b))
        case 'lastFa': {
          const atA = a.lastFaPickup?.at ?? ''
          const atB = b.lastFaPickup?.at ?? ''
          return atA.localeCompare(atB)
        }
        case 'faTeam':
          return (a.lastFaPickup?.team_name ?? '').localeCompare(b.lastFaPickup?.team_name ?? '')
        case 'zTotal':
          return (a.totalZ ?? -999) - (b.totalZ ?? -999)
        case 'valueRank':
          return (a.valueRank ?? 999999) - (b.valueRank ?? 999999)
        case 'gp':
          return a.gp - b.gp
        default:
          return 0
      }
    }
    list.sort((a, b) => (sortAsc ? cmp(a, b) : cmp(b, a)))
    return list
  }, [filtered, sortCol, sortAsc])

  const handleSort = (col: SortCol) => {
    if (col === sortCol) setSortAsc(a => !a)
    else {
      setSortCol(col)
      setSortAsc(col === 'player' || col === 'faTeam' || col === 'status')
    }
  }

  if (draftLoading || poolLoading) return <LoadingSpinner />
  if (draftError || poolError) {
    return <ErrorMessage message={getErrorMessage(draftError ?? poolError, 'Failed to load FA report.')} />
  }

  if (mobileRedesign) {
    return (
      <MobileFaReport
        calcMode={calcMode}
        onCalcModeChange={setCalcMode}
        search={search}
        onSearchChange={setSearch}
        activityError={!!activityError}
        rows={sorted}
        sortCol={sortCol}
        sortAsc={sortAsc}
        onSort={handleSort}
      />
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div className="max-w-screen-2xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">🆓 FA Report</h1>
          <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden text-sm">
            {(['totals', 'per_game'] as const).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setCalcMode(m)}
                className={`px-3 py-1.5 ${calcMode === m ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200'}`}
              >
                {m === 'totals' ? 'Totals' : 'Per Game'}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Undrafted only, at least {REPORT_MIN_GP} GP, top {FA_REPORT_MAX_SEASON_RANK} by season rank vs the full player pool (8-category z-score; min 1 GP to enter the rank pool).
        </p>
        {activityError && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Could not load league activity; FA pickup dates and teams are unavailable.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <input
            type="search"
            placeholder="Search player or NBA team…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 w-full sm:w-64"
          />
          <span className="text-xs text-gray-400 tabular-nums">{sorted.length} players</span>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-auto max-h-[70vh]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-20 bg-gray-50 dark:bg-gray-900">
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <SortTh col="player" label="Player" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} align="left" />
                <th className="px-2 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 hidden sm:table-cell">NBA</th>
                <SortTh col="lastFa" label="Last FA pickup" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} align="left" />
                <SortTh col="faTeam" label="Picked up by" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} align="left" />
                <SortTh col="status" label="Status" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} align="left" />
                <SortTh col="gp" label="GP" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} align="right" />
                <SortTh col="zTotal" label="zTotal" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} align="right" />
                <SortTh col="valueRank" label="Season rank" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} align="right" />
              </tr>
            </thead>
            <tbody>
              {sorted.map(row => (
                <tr key={row.player_name} className="group border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-2 py-1.5 sm:py-2 font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap sticky left-0 z-10 bg-white dark:bg-gray-800 group-hover:bg-gray-50 dark:group-hover:bg-gray-700/50 border-r border-gray-200 dark:border-gray-700">
                    <PlayerNameLink name={row.player_name} playerId={row.player_id ?? undefined} />
                  </td>
                  <td className="px-2 py-1.5 text-gray-500 dark:text-gray-400 text-xs hidden sm:table-cell">{row.pro_team}</td>
                  <td className="px-2 py-1.5 text-gray-700 dark:text-gray-300 text-xs whitespace-nowrap">
                    {row.lastFaPickup ? (
                      <>
                        {formatFaPickupDate(row.lastFaPickup.at)}
                        <span className="ml-1 text-gray-400">({row.lastFaPickup.kind === 'waiver' ? 'waiver' : 'add'})</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-gray-700 dark:text-gray-300 text-xs whitespace-nowrap">
                    {row.lastFaPickup
                      ? fantasyTeamOptionLabel(row.lastFaPickup.team_name, isMyTeam(row.lastFaPickup.team_id))
                      : '—'}
                  </td>
                  <td className="px-2 py-1.5 text-gray-700 dark:text-gray-300 text-xs whitespace-nowrap">
                    {faReportCurrentStatus(row) === FA_REPORT_STATUS_ON_TEAM ? (
                      <span className="text-green-700 dark:text-green-400">{FA_REPORT_STATUS_ON_TEAM}</span>
                    ) : (
                      <span className="text-gray-500 dark:text-gray-400">{FA_REPORT_STATUS_FREE_AGENT}</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right text-gray-700 dark:text-gray-300 tabular-nums">{row.gp}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs text-gray-700 dark:text-gray-300 tabular-nums">
                    {row.totalZ !== null ? row.totalZ.toFixed(2) : '—'}
                  </td>
                  <td className="px-2 py-1.5 text-right text-gray-700 dark:text-gray-300 tabular-nums">
                    {row.valueRank !== null ? `#${row.valueRank}` : '—'}
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-sm text-gray-400">No undrafted players match.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function SortTh({
  col,
  label,
  sortCol,
  sortAsc,
  onSort,
  align,
}: {
  col: SortCol
  label: string
  sortCol: SortCol
  sortAsc: boolean
  onSort: (col: SortCol) => void
  align: 'left' | 'right'
}) {
  const active = sortCol === col
  return (
    <th
      onClick={() => onSort(col)}
      tabIndex={0}
      role="button"
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onSort(col)}
      aria-sort={active ? (sortAsc ? 'ascending' : 'descending') : 'none'}
      className={`px-2 py-2 text-xs font-semibold cursor-pointer select-none ${
        align === 'right' ? 'text-right' : 'text-left'
      } ${active ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
    >
      {label}{active ? (sortAsc ? ' ↑' : ' ↓') : ''}
    </th>
  )
}

import { useMyTeam } from '../../context/useMyTeam'
import PlayerNameLink from '../../components/PlayerNameLink'
import { fantasyTeamOptionLabel } from '../../myTeam/display'
import { REPORT_MIN_GP } from '../../utils/draftReport'
import {
  FA_REPORT_MAX_SEASON_RANK,
  FA_REPORT_STATUS_ON_TEAM,
  faReportCurrentStatus,
  formatFaPickupDate,
  type FaReportRow,
} from '../../utils/faReport'
import { DataTable, Segmented, type Column } from '../ui'
import './draft.css'

type CalcMode = 'totals' | 'per_game'
export type FaSortCol = 'player' | 'lastFa' | 'faTeam' | 'status' | 'zTotal' | 'valueRank' | 'gp'

interface Props {
  calcMode: CalcMode
  onCalcModeChange: (m: CalcMode) => void
  search: string
  onSearchChange: (q: string) => void
  activityError: boolean
  /** Filtered and sorted rows. */
  rows: FaReportRow[]
  sortCol: FaSortCol
  sortAsc: boolean
  onSort: (col: FaSortCol) => void
}

const CALC_OPTIONS = [
  { value: 'totals', label: 'Totals' },
  { value: 'per_game', label: 'Per Game' },
] as const

/** Phone FA Report (step 5): same columns as desktop, player pinned, sortable headers. */
export default function MobileFaReport({ calcMode, onCalcModeChange, search, onSearchChange, activityError, rows, sortCol, sortAsc, onSort }: Props) {
  const { isMyTeam } = useMyTeam()

  const columns: Column<FaReportRow>[] = [
    {
      key: 'player',
      header: 'Player',
      align: 'left',
      pinned: true,
      sortable: true,
      cell: (r) => <PlayerNameLink name={r.player_name} playerId={r.player_id ?? undefined} className="mr-fa-name" />,
    },
    { key: 'nba', header: 'NBA', align: 'left', cell: (r) => r.pro_team },
    {
      key: 'lastFa',
      header: 'Last FA pickup',
      align: 'left',
      sortable: true,
      cell: (r) =>
        r.lastFaPickup ? (
          <>
            {formatFaPickupDate(r.lastFaPickup.at)}{' '}
            <span className="mr-meta">({r.lastFaPickup.kind === 'waiver' ? 'waiver' : 'add'})</span>
          </>
        ) : (
          '—'
        ),
    },
    {
      key: 'faTeam',
      header: 'Picked up by',
      align: 'left',
      sortable: true,
      cell: (r) => (r.lastFaPickup ? fantasyTeamOptionLabel(r.lastFaPickup.team_name, isMyTeam(r.lastFaPickup.team_id)) : '—'),
    },
    {
      key: 'status',
      header: 'Status',
      align: 'left',
      sortable: true,
      cell: (r) => (
        <span className={faReportCurrentStatus(r) === FA_REPORT_STATUS_ON_TEAM ? 'mr-fa-on-team' : 'mr-meta'}>
          {faReportCurrentStatus(r)}
        </span>
      ),
    },
    { key: 'gp', header: 'GP', sortable: true, cell: (r) => <span className="mr-num">{r.gp}</span> },
    { key: 'zTotal', header: 'zTotal', sortable: true, cell: (r) => <span className="mr-num">{r.totalZ !== null ? r.totalZ.toFixed(2) : '—'}</span> },
    {
      key: 'valueRank',
      header: 'Season rank',
      sortable: true,
      cell: (r) => <span className="mr-num">{r.valueRank !== null ? `#${r.valueRank}` : '—'}</span>,
    },
  ]

  return (
    <div className="mr-root mr-page mr-fa">
      <div className="mr-page-head">
        <h1 className="mr-h1">🆓 FA Report</h1>
      </div>
      <Segmented label="Value calc" options={CALC_OPTIONS} value={calcMode} onChange={onCalcModeChange} size="sm" />
      <p className="mr-meta mr-dr-note">
        Undrafted only, at least {REPORT_MIN_GP} GP, top {FA_REPORT_MAX_SEASON_RANK} by season rank vs the full player pool
        (8-category z-score; min 1 GP in the rank pool).
      </p>
      {activityError && (
        <p className="mr-fa-warn">Could not load league activity; FA pickup dates and teams are unavailable.</p>
      )}
      <div className="mr-fa-search">
        <input
          type="search"
          className="mr-fa-input"
          placeholder="Search player or NBA team…"
          aria-label="Search player or NBA team"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        <span className="mr-meta mr-fa-count mr-num">{rows.length} players</span>
      </div>
      <DataTable
        caption="Undrafted free agents"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.player_name}
        sort={{ key: sortCol, dir: sortAsc ? 'asc' : 'desc' }}
        // The page owns the toggle rule (text columns start A→Z, numbers keep today's order).
        onSortChange={(s) => onSort(s.key as FaSortCol)}
        empty="No undrafted players match."
      />
    </div>
  )
}

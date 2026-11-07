import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import type { RankingStats, TeamRankChange } from '../../../types/api'
import DataDateBadge from '../../../components/DataDateBadge'
import EspnUpdatedNote from '../../../components/EspnUpdatedNote'
import { MyTeamMark } from '../../../components/MyTeamMark'
import { Button, Chip, ChipRow, DataTable, Delta, Segmented, SelectSheet, type Column } from '../../ui'
import './rankings.css'

export type RankingsView = 'standings' | 'rankings'
export type RankingsMode = 'averages' | 'totals'
export type RankingsLayout = 'cards' | 'table'
type SortDir = 'asc' | 'desc'

/**
 * Phone view of Standings & Rankings (mobile redesign, step 4).
 *
 * `pages/Rankings.tsx` owns all state, URL sync and data; this only lays the
 * same controls and numbers out for a phone: Layout / Show / Values toggles,
 * a collapsible date range (From/To, Apply, Clear, Quick range), the movers
 * toggle (Rankings view only), the two summary tiles, and either a table with
 * "#rank team" pinned or one card per team. Standings view has no colored
 * deltas at all; Rankings view shows last night's ▲/▼.
 */
export interface RankingsMobileProps {
  title: string
  explainer: string
  dataDate?: string
  espnUpdatedAt?: string | null
  share: ReactNode

  layout: RankingsLayout
  onLayout: (v: RankingsLayout) => void
  view: RankingsView
  onView: (v: RankingsView) => void
  mode: RankingsMode
  onMode: (v: RankingsMode) => void

  startDate: string
  endDate: string
  minDate?: string
  today: string
  dateError: string
  onStartDate: (v: string) => void
  onEndDate: (v: string) => void
  onApply: () => void
  onClear: () => void
  onQuickRange: (days: number) => void
  /** Applied range label ("Nov 1 – Nov 6"); empty for the season. */
  appliedRangeLabel: string
  mismatchNote?: string
  rangeError?: string

  hasMoves: boolean
  showMoves: boolean
  onToggleMoves: () => void

  pace?: number | null
  daysLeft?: number | null

  rankings: RankingStats[]
  categoryKeys: string[]
  movesByTeam: Map<number, TeamRankChange>
  cellDisplay: (team: RankingStats, key: string) => string | number | undefined
  sortBy: string
  sortOrder: SortDir
  onSort: (column: string) => void
  onSortBy: (column: string) => void
  onToggleOrder: () => void
  isMyTeam: (teamId: number) => boolean
}

const QUICK_DAYS = [1, 7, 15, 30] as const

export function RankingsMobile(p: RankingsMobileProps) {
  const navigate = useNavigate()
  const [rangeOpen, setRangeOpen] = useState(false)
  const isStandings = p.view === 'standings'
  // Standings view stays plain: no ▲/▼, no "–", no "+n".
  const moveOf = (teamId: number) => (isStandings ? undefined : p.movesByTeam.get(teamId))
  const openTeam = (t: RankingStats) => navigate(`/team/${t.team.team_id}`)
  // When moves are on screen every number gets a fixed-width slot for its
  // ▲/▼, so values (and ranks) stay in a straight column with or without one.
  const slots = !isStandings && p.movesByTeam.size > 0
  const withDelta = (value: ReactNode, delta: ReactNode) =>
    slots ? (
      <span className="mr-rk-num">
        {value}
        <span className="mr-rk-dslot">{delta}</span>
      </span>
    ) : (
      value
    )

  const sortOptions = [
    { value: 'rank', label: 'Rank' },
    { value: 'team', label: 'Team' },
    ...p.categoryKeys.map((k) => ({ value: k, label: k })),
    { value: 'total_points', label: 'Total' },
    { value: 'gp', label: 'GP' },
  ]

  const teamLink = (t: RankingStats, className: string) => (
    <Link to={`/team/${t.team.team_id}`} className={className} onClick={(e) => e.stopPropagation()}>
      {t.team.team_name}
    </Link>
  )

  const headSortBtn = (key: string, label: string) => {
    const active = p.sortBy === key
    return (
      <button
        type="button"
        className="mr-th-btn mr-rk-hsort"
        aria-label={`Sort by ${key === 'rank' ? 'rank' : 'team name'}`}
        aria-pressed={active}
        onClick={() => p.onSort(key)}
      >
        {label}
        {active && <span aria-hidden="true">{p.sortOrder === 'asc' ? ' ▲' : ' ▼'}</span>}
      </button>
    )
  }

  const columns: Column<RankingStats>[] = [
    {
      key: 'team',
      // Rank and Team were two sortable columns; pinned together they keep both sorts.
      header: (
        <span className="mr-rk-pinhead">
          {headSortBtn('rank', '#')}
          {headSortBtn('team', 'TEAM')}
        </span>
      ),
      pinned: true,
      cell: (t, i) => (
        <span className="mr-rk-pin">
          <span className="mr-rk-rank">#{t.rank || i + 1}</span>
          {slots && (
            <span className="mr-rk-dslot mr-rk-rank-slot">
              <Delta value={moveOf(t.team.team_id)?.rank_delta} kind="total" />
            </span>
          )}
          {teamLink(t, 'mr-rk-name')}
        </span>
      ),
    },
    ...p.categoryKeys.map<Column<RankingStats>>((k) => ({
      key: k,
      header: k,
      sortable: true,
      cell: (t) => (
withDelta(p.cellDisplay(t, k), <Delta value={moveOf(t.team.team_id)?.categories[k]} digits={1} />)
      ),
    })),
    {
      key: 'total_points',
      header: 'TOTAL',
      headerLabel: 'Total',
      sortable: true,
      className: 'mr-rk-total',
      cell: (t) => {
        const m = moveOf(t.team.team_id)
        return withDelta(p.cellDisplay(t, 'total_points'), m && <Delta value={m.total_delta} kind="total" digits={1} />)
      },
    },
    {
      key: 'gp',
      header: 'GP',
      sortable: true,
      className: 'mr-rk-gp',
      cell: (t) => (
withDelta(p.cellDisplay(t, 'gp'), <Delta value={moveOf(t.team.team_id)?.gp_delta} kind="gp" />)
      ),
    },
  ]

  const rangeButtonLabel = p.appliedRangeLabel || 'Season'

  return (
    <div className="mr-root mr-rk">
      <div className="mr-rk-title">
        <div className="mr-rk-title-text">
          <h1 className="mr-h1">{p.title}</h1>
          {p.appliedRangeLabel && <span className="mr-rk-range-sub">{p.appliedRangeLabel}</span>}
          {p.dataDate ? <DataDateBadge dataDate={p.dataDate} /> : <EspnUpdatedNote updatedAt={p.espnUpdatedAt} />}
        </div>
        <div className="mr-rk-share">{p.share}</div>
      </div>
      <p className="mr-meta mr-rk-explain">{p.explainer}</p>

      <div className="mr-rk-three">
        <div className="mr-rk-lab">
          <span className="mr-meta">Layout</span>
          <Segmented
            label="Layout"
            size="sm"
            value={p.layout}
            onChange={p.onLayout}
            options={[{ value: 'table', label: 'Table' }, { value: 'cards', label: 'Cards' }]}
          />
        </div>
        <div className="mr-rk-lab">
          <span className="mr-meta">Show</span>
          <Segmented
            label="Show"
            size="sm"
            value={p.view}
            onChange={p.onView}
            options={[{ value: 'standings', label: 'Standings' }, { value: 'rankings', label: 'Rankings' }]}
          />
        </div>
        <div className="mr-rk-lab">
          <span className="mr-meta">Values</span>
          <Segmented
            label="Values"
            size="sm"
            value={p.mode}
            onChange={p.onMode}
            options={[{ value: 'averages', label: 'Averages' }, { value: 'totals', label: 'Totals' }]}
          />
        </div>
      </div>

      <div className="mr-rk-frow">
        <button
          type="button"
          className="mr-select mr-rk-grow"
          aria-expanded={rangeOpen}
          aria-controls="mr-rk-range"
          onClick={() => setRangeOpen((o) => !o)}
        >
          <span className="mr-select-label">
            Date range: <b>{rangeButtonLabel}</b>
          </span>
          <span className="mr-caret" aria-hidden="true">{rangeOpen ? '▴' : '▾'}</span>
        </button>
        {p.hasMoves && !isStandings && (
          <Chip selected={p.showMoves} onClick={p.onToggleMoves}>
            <span aria-hidden="true">▲▼</span>
            {p.showMoves ? 'Hide movers' : 'Show movers'}
          </Chip>
        )}
      </div>

      {rangeOpen && (
        <div id="mr-rk-range" className="mr-card mr-rk-range">
          <div className="mr-rk-frow">
            <label className="mr-rk-inp">
              <span>From</span>
              <input
                type="date"
                value={p.startDate}
                min={p.minDate}
                max={p.endDate || p.today}
                onChange={(e) => p.onStartDate(e.target.value)}
              />
            </label>
            <label className="mr-rk-inp">
              <span>To</span>
              <input
                type="date"
                value={p.endDate}
                min={p.startDate || p.minDate}
                max={p.today}
                onChange={(e) => p.onEndDate(e.target.value)}
              />
            </label>
          </div>
          <div className="mr-rk-frow mr-rk-end">
            <button type="button" className="mr-link" onClick={() => p.onEndDate(p.today)}>
              To today
            </button>
          </div>
          <div className="mr-rk-frow">
            <Button variant="primary" size="sm" grow disabled={!p.startDate || !p.endDate || !!p.dateError} onClick={p.onApply}>
              Apply
            </Button>
            <Button size="sm" grow onClick={p.onClear}>
              Clear
            </Button>
          </div>
          <span className="mr-meta">Quick range</span>
          <ChipRow label="Quick date range presets">
            {QUICK_DAYS.map((d) => (
              <Chip key={d} onClick={() => p.onQuickRange(d)} aria-label={`Set date range to last ${d} days through today`}>
                Last {d}d
              </Chip>
            ))}
          </ChipRow>
          {p.dateError && <p className="mr-rk-err" role="alert">{p.dateError}</p>}
        </div>
      )}

      {p.mismatchNote && <p className="mr-rk-note">{p.mismatchNote}</p>}
      {p.rangeError && <p className="mr-rk-note mr-rk-note-err">{p.rangeError}</p>}

      <div className="mr-rk-tiles">
        <div className="mr-rk-tile">
          <span className="mr-rk-tl">⚡ NBA Avg Pace</span>
          <span className="mr-rk-tv">{p.pace == null ? '—' : p.pace.toFixed(1)}</span>
        </div>
        <div className="mr-rk-tile">
          <span className="mr-rk-tl">📅 Days Remaining</span>
          <span className="mr-rk-tv">{p.daysLeft ?? 0}</span>
        </div>
      </div>

      {p.layout === 'table' ? (
        <DataTable
          caption={p.title}
          columns={columns}
          rows={p.rankings}
          rowKey={(t) => String(t.team.team_id)}
          sort={{ key: p.sortBy, dir: p.sortOrder }}
          onSortChange={(s) => p.onSort(s.key)}
          isHighlighted={(t) => p.isMyTeam(t.team.team_id)}
          onRowClick={openTeam}
          className={`mr-rk-table ${slots ? 'mr-rk-slots' : ''}`.trim()}
        />
      ) : (
        <>
          <div className="mr-rk-frow">
            <span className="mr-meta">Sort by</span>
            <SelectSheet id="rankings-sort" label="Sort by" options={sortOptions} value={p.sortBy} onChange={p.onSortBy} />
            <Button
              size="sm"
              onClick={p.onToggleOrder}
              aria-label={p.sortOrder === 'asc' ? 'Sort ascending' : 'Sort descending'}
            >
              {p.sortOrder === 'asc' ? '↑ Asc' : '↓ Desc'}
            </Button>
          </div>
          <ul className="mr-rk-cards" aria-label={p.title}>
            {p.rankings.map((t, i) => {
              const m = moveOf(t.team.team_id)
              const my = p.isMyTeam(t.team.team_id)
              return (
                <li key={t.team.team_id} className={`mr-card mr-rk-card ${my ? 'mr-rk-me' : ''}`.trim()} onClick={() => openTeam(t)}>
                  <div className="mr-rk-card-head">
                    <span className="mr-h2 mr-rk-card-name">
                      <span>#{t.rank || i + 1}</span>
                      {m && <Delta value={m.rank_delta} />}
                      <span aria-hidden="true">&nbsp;·&nbsp;</span>
                      {teamLink(t, 'mr-rk-name')}
                      <MyTeamMark teamId={t.team.team_id} />
                    </span>
                    <span className="mr-rk-tot">
                      <span className="mr-rk-tl">Total</span>
                      <b>{p.cellDisplay(t, 'total_points')}</b>
                      {m && <span className="mr-rk-tot-d"><Delta value={m.total_delta} kind="total" digits={1} /></span>}
                    </span>
                    <span className="mr-rk-tot">
                      <span className="mr-rk-tl">GP</span>
                      <b>{p.cellDisplay(t, 'gp')}</b>
                      {m && <span className="mr-rk-tot-d"><Delta value={m.gp_delta} kind="gp" /></span>}
                    </span>
                  </div>
                  <div className="mr-rk-cgrid">
                    {p.categoryKeys.map((k) => (
                      <div key={k} className="mr-rk-cg">
                        <span className="mr-rk-tl">{k}</span>
                        {withDelta(<b>{p.cellDisplay(t, k)}</b>, <Delta value={m?.categories[k]} digits={1} />)}
                      </div>
                    ))}
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}

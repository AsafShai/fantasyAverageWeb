import type { ReactNode } from 'react'
import DataDateBadge from '../../../components/DataDateBadge'
import EspnUpdatedNote from '../../../components/EspnUpdatedNote'
import { MyTeamMark } from '../../../components/MyTeamMark'
import type { Team } from '../../../types/api'
import { getHeatmapColor, getTextColor } from '../../../utils/colorUtils'
import { Button, Card, Chip, ChipRow, DataTable, Segmented, type Column, type SortState } from '../../ui'
import './analytics.css'

export type AnalyticsUrlTab = 'heat' | 'race' | 'shots'

const ANALYTICS_TAB_OPTIONS: { value: AnalyticsUrlTab; label: string }[] = [
  { value: 'heat', label: 'Heatmap' },
  { value: 'race', label: 'Rankings Over Time' },
  { value: 'shots', label: 'Shooting Stats' },
]

const QUICK_DAYS = [1, 7, 15, 30] as const

export interface HeatmapRows {
  teams: Team[]
  categories: string[]
  data: number[][]
  normalized_data: number[][]
  ranks_data: number[][]
}

interface HeatRow {
  team: Team
  i: number
}

export interface AnalyticsMobileProps {
  tab: AnalyticsUrlTab
  onTab: (tab: AnalyticsUrlTab) => void
  dataDate?: string
  espnUpdatedAt?: string | null

  heatmap: HeatmapRows | null
  sort: SortState | null
  onSort: (sort: SortState) => void
  highlightedTeamId: number | null
  onTeamTap: (teamId: number) => void
  isMyTeam: (teamId: number) => boolean
  isDark: boolean

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
  /** "Nov 1 - Nov 6" when a range is applied, else empty. */
  appliedRangeLabel: string
  mismatchNote?: string
  rangeError?: string

  /** Rankings Over Time and Shooting Stats (their phone layouts live in those components). */
  race: ReactNode
  shots: ReactNode
}

const formatCell = (category: string, value: number | undefined) => {
  if (category === 'GP') return String(Math.round(value ?? 0))
  if (category === 'FG%' || category === 'FT%') return ((value ?? 0) * 100).toFixed(2) + '%'
  return (value ?? 0).toFixed(2)
}

/**
 * League Analytics on a phone: the three tabs as a segmented control
 * (?tab=heat|race|shots), the heatmap with today's From/To, Apply, Clear and
 * Last 1d/7d/15d/30d, and a pinned-team heat table (red / white / green vs
 * the league average, rank in brackets, tap a header to sort, tap a team to
 * spotlight its row).
 */
export function AnalyticsMobile(p: AnalyticsMobileProps) {
  const h = p.heatmap
  const rows: HeatRow[] = h ? h.teams.map((team, i) => ({ team, i })) : []

  const columns: Column<HeatRow>[] = [
    {
      key: 'team',
      header: 'Team',
      pinned: true,
      align: 'left',
      sortable: true,
      firstDir: 'asc',
      className: 'mr-an-team',
      cell: (r) => (
        <button
          type="button"
          className="mr-an-teambtn"
          aria-pressed={p.highlightedTeamId === r.team.team_id}
          onClick={() => p.onTeamTap(r.team.team_id)}
        >
          <span className="mr-an-teamname">{r.team.team_name}</span>
          <MyTeamMark teamId={r.team.team_id} />
        </button>
      ),
    },
    ...(h?.categories ?? []).map<Column<HeatRow>>((cat, c) => ({
      key: cat,
      header: cat,
      sortable: true,
      align: 'center',
      className: `mr-an-heat ${cat === 'GP' ? 'mr-an-gp' : ''}`.trim(),
      cell: (r) => {
        const norm = h!.normalized_data[r.i]?.[c] ?? 0
        const rank = h!.ranks_data[r.i]?.[c]
        return (
          <span
            className="mr-an-cell"
            style={{ backgroundColor: getHeatmapColor(norm, p.isDark), color: getTextColor(norm, p.isDark) }}
          >
            <span className="mr-an-val">{formatCell(cat, h!.data[r.i]?.[c])}</span>
            {rank !== undefined && rank > 0 && <span className="mr-an-rank">({rank})</span>}
          </span>
        )
      },
    })),
  ]

  return (
    <div className="mr-root mr-an">
      <div className="mr-an-title">
        <h1 className="mr-h1">League Analytics</h1>
        {p.dataDate ? <DataDateBadge dataDate={p.dataDate} /> : <EspnUpdatedNote updatedAt={p.espnUpdatedAt} />}
      </div>

      <Segmented label="League Analytics section" className="mr-an-tabs" options={ANALYTICS_TAB_OPTIONS} value={p.tab} onChange={p.onTab} />

      {p.tab === 'heat' && (
        <Card
          className="mr-an-card"
          title={
            <>
              Performance Heatmap
              {p.appliedRangeLabel && <span className="mr-an-range-sub"> – {p.appliedRangeLabel}</span>}
            </>
          }
        >
          <div className="mr-an-dates">
            <label className="mr-an-lab">
              <span className="mr-meta">From</span>
              <input
                type="date"
                className="mr-an-inp"
                value={p.startDate}
                min={p.minDate}
                max={p.endDate || p.today}
                onChange={(e) => p.onStartDate(e.target.value)}
              />
            </label>
            <div className="mr-an-lab">
              <span className="mr-meta">
                <label htmlFor="mr-an-to">To</label>{' '}
                <button type="button" className="mr-link mr-an-today" onClick={() => p.onEndDate(p.today)}>
                  Today
                </button>
              </span>
              <input
                id="mr-an-to"
                type="date"
                className="mr-an-inp"
                value={p.endDate}
                min={p.startDate || p.minDate}
                max={p.today}
                onChange={(e) => p.onEndDate(e.target.value)}
              />
            </div>
          </div>
          <div className="mr-an-frow">
            <Button variant="primary" size="sm" disabled={!p.startDate || !p.endDate || !!p.dateError} onClick={p.onApply}>
              Apply
            </Button>
            {(p.startDate || p.endDate) && (
              <Button size="sm" onClick={p.onClear}>
                Clear
              </Button>
            )}
            <ChipRow label="Quick date range presets" className="mr-an-quick">
              {QUICK_DAYS.map((d) => (
                <Chip key={d} onClick={() => p.onQuickRange(d)} aria-label={`Set date range to last ${d} days through today`}>
                  Last {d}d
                </Chip>
              ))}
            </ChipRow>
          </div>
          {p.dateError && <p className="mr-an-note mr-an-note-err" role="alert">{p.dateError}</p>}
          {p.mismatchNote && <p className="mr-an-note">{p.mismatchNote}</p>}
          {p.rangeError && <p className="mr-an-note mr-an-note-err">{p.rangeError}</p>}
          <p className="mr-meta mr-an-explain">
            Red = below league average, white = average, green = above average; the number in brackets is the team’s
            rank in that category. Tap a column header to sort, tap a team to spotlight it.
          </p>
          <DataTable
            caption="Performance Heatmap"
            className="mr-an-table"
            columns={columns}
            rows={rows}
            rowKey={(r) => String(r.team.team_id)}
            sort={p.sort}
            onSortChange={p.onSort}
            isHighlighted={(r) => p.isMyTeam(r.team.team_id)}
            rowClassName={(r) => (p.highlightedTeamId === r.team.team_id ? 'mr-an-spot' : undefined)}
            empty="No heatmap data"
          />
        </Card>
      )}

      {p.tab === 'race' && <Card className="mr-an-card">{p.race}</Card>}
      {p.tab === 'shots' && p.shots}
    </div>
  )
}

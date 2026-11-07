import { useMemo, useState } from 'react'
import { useMyTeam } from '../../context/MyTeamContext'
import { fantasyTeamOptionLabel, leadWithMyTeam } from '../../myTeam/display'
import {
  HEAT_MIN_SEASON_MONTHS,
  REPORT_MIN_GP,
  heatColor,
  valueTag,
  type DraftBadge,
  type ScoredPick,
  type TeamDiff,
} from '../../utils/draftReport'
import { Card, DataTable, Segmented, SelectSheet, type Column, type SortState } from '../ui'
import './draft.css'

type CalcMode = 'totals' | 'per_game'
type SortCol = 'pick' | 'diff' | 'valueRank'

interface TeamColumn {
  team_id: number
  team_name: string
}

interface Props {
  calcMode: CalcMode
  onCalcModeChange: (m: CalcMode) => void
  showHeat: boolean
  teamColumns: TeamColumn[]
  rounds: number[]
  gridByRoundTeam: Map<string, ScoredPick>
  /** Empty when the steals/busts flag is off (the sections are hidden then). */
  teamDiffs: TeamDiff[]
  steals: ScoredPick[]
  busts: ScoredPick[]
  /** All Picks rows, already filtered by team and sorted. */
  picks: ScoredPick[]
  sortCol: SortCol
  sortAsc: boolean
  onSort: (col: SortCol, asc: boolean) => void
  teamFilter: number | null
  onTeamFilterChange: (id: number | null) => void
}

const CALC_OPTIONS = [
  { value: 'totals', label: 'Totals' },
  { value: 'per_game', label: 'Per Game' },
] as const

const BADGE_CLASS: Record<DraftBadge, string> = {
  Steal: 'mr-dr-steal',
  Solid: 'mr-dr-solid',
  Fair: 'mr-dr-fair',
  Reach: 'mr-dr-reach',
  Bust: 'mr-dr-bust',
  INJ: 'mr-dr-fair',
  'Low GP': 'mr-dr-reach',
  DNP: 'mr-dr-fair',
}

function Verdict({ badge, children }: { badge: DraftBadge; children?: string }) {
  return <span className={`mr-pill mr-dr-badge ${BADGE_CLASS[badge]}`}>{children ?? badge}</span>
}

const signed = (n: number, digits = 0) => (n > 0 ? `+${n.toFixed(digits)}` : n.toFixed(digits))
const toneCls = (n: number) => (n >= 0 ? 'mr-dr-pos' : 'mr-dr-neg')

/** Phone Draft Report (step 5): board, team draft value, risers/fallers, all picks. */
export default function MobileDraftReport(props: Props) {
  const { calcMode, onCalcModeChange, showHeat, teamColumns, rounds, gridByRoundTeam, teamDiffs, steals, busts } = props
  const { myTeamId, isMyTeam } = useMyTeam()

  return (
    <div className="mr-root mr-page mr-dr">
      <div className="mr-page-head">
        <h1 className="mr-h1">📝 Draft Report Card</h1>
      </div>
      <Segmented label="Value calc" options={CALC_OPTIONS} value={calcMode} onChange={onCalcModeChange} size="sm" />
      <p className="mr-meta mr-dr-note">
        Every pick vs realized season value (8-cat z-score rank). Diff = pick number − value rank: positive means the
        player returned more than draft slot price.
      </p>
      <p className="mr-meta mr-dr-note">
        Value calc: season stats · all 8 categories weighted equally · min {REPORT_MIN_GP} GP to rank (1–{REPORT_MIN_GP - 1}{' '}
        GP = Low GP; 0 GP = DNP).
      </p>

      <Card title={showHeat ? 'Draft Board — value heat' : 'Draft Board'}>
        <div className="mr-tw" tabIndex={0} role="region" aria-label="Draft board">
          <table className="mr-t mr-dr-board">
            <caption className="sr-only">Draft board</caption>
            <thead>
              <tr>
                <th scope="col" className="mr-pin mr-c">
                  <span className="mr-th-label">Rd</span>
                </th>
                {teamColumns.map((t) => (
                  <th key={t.team_id} scope="col" className={`mr-l ${isMyTeam(t.team_id) ? 'mr-dr-mine' : ''}`.trim()}>
                    <span className="mr-th-label">{t.team_name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rounds.map((round) => (
                <tr key={round}>
                  <th scope="row" className="mr-pin mr-c mr-num">
                    {round}
                  </th>
                  {teamColumns.map((t) => {
                    const p = gridByRoundTeam.get(`${round}-${t.team_id}`)
                    if (!p) return <td key={t.team_id} />
                    return (
                      <td key={t.team_id} className="mr-l" style={showHeat ? { backgroundColor: heatColor(p) } : undefined}>
                        <span className="mr-dr-cell">
                          <b>{p.player_name}</b>
                          <span className="mr-meta">
                            {p.pick} → {valueTag(p)}
                            {p.valueRank !== null && p.gp !== null ? ` · ${p.gp}gp` : ''}
                          </span>
                        </span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mr-meta">
          {showHeat
            ? 'Blue = returned above slot · Red = below slot / INJ / Low GP / DNP · Gray = about right.'
            : `Value heat appears after the first ${HEAT_MIN_SEASON_MONTHS} months of the season — too early to judge picks.`}
        </p>
      </Card>

      {teamDiffs.length > 0 && <TeamDraftValue teamDiffs={teamDiffs} isMyTeam={isMyTeam} />}

      {steals.length > 0 && (
        <Card title="📈 Biggest Risers">
          <MoverList picks={steals} steal />
        </Card>
      )}
      {busts.length > 0 && (
        <Card title="📉 Biggest Fallers">
          <MoverList picks={busts} />
        </Card>
      )}

      <AllPicks {...props} myTeamId={myTeamId} isMyTeam={isMyTeam} />
    </div>
  )
}

function TeamDraftValue({ teamDiffs, isMyTeam }: { teamDiffs: TeamDiff[]; isMyTeam: (id: number | null | undefined) => boolean }) {
  const [open, setOpen] = useState<Set<number>>(new Set())
  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const rows = teamDiffs.map((t, i) => ({ ...t, rank: i + 1 }))
  type Row = (typeof rows)[number]
  const columns: Column<Row>[] = [
    {
      key: 'team',
      header: '# Team',
      align: 'left',
      pinned: true,
      cell: (t) => (
        <span className="mr-dr-team">
          <span className="mr-dr-rank mr-num">{t.rank}</span>
          <span className="mr-dr-tname">{t.team_name}</span>
        </span>
      ),
    },
    { key: 'total', header: 'Total Diff', cell: (t) => <span className={`mr-num ${toneCls(t.totalDiff)}`}>{signed(t.totalDiff)}</span> },
    { key: 'avg', header: 'Avg Diff', cell: (t) => <b className={`mr-num ${toneCls(t.avgDiff)}`}>{signed(t.avgDiff, 1)}</b> },
    {
      key: 'n',
      header: 'Ranked / Picks',
      headerLabel: "Ranked / Picks: how many of the team's draft picks earned a value rank",
      cell: (t) => (
        <span className="mr-num mr-dr-n">
          {t.n}/{t.total}
          {t.unranked.length > 0 && (
            <span className="mr-dr-caret" aria-hidden="true">
              {open.has(t.team_id) ? '▾' : '▸'}
            </span>
          )}
        </span>
      ),
    },
  ]

  return (
    <Card title="Team Draft Value — diff vs slot">
      <DataTable
        caption="Team draft value"
        columns={columns}
        rows={rows}
        rowKey={(t) => String(t.team_id)}
        isHighlighted={(t) => isMyTeam(t.team_id)}
        onRowClick={(t) => t.unranked.length > 0 && toggle(t.team_id)}
        renderAfterRow={(t) =>
          open.has(t.team_id) ? (
            <tr className="mr-dr-unranked-row">
              <td colSpan={columns.length} className="mr-l">
                <div className="mr-dr-unranked">
                  <span className="mr-meta">Not ranked (excluded from diff):</span>
                  <ul>
                    {t.unranked.map((u) => (
                      <li key={u.pick}>
                        <Verdict badge={u.badge} />
                        <span>{u.player_name}</span>
                        <span className="mr-meta">
                          #{u.pick} · {u.gp ?? 0}gp
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </td>
            </tr>
          ) : null
        }
      />
      <p className="mr-meta">
        Sum / avg of (pick − value rank) over ranked picks. Positive = team's picks returned above draft slot. Tap a row
        with ▸ to show its unranked picks.
      </p>
    </Card>
  )
}

function MoverList({ picks, steal = false }: { picks: ScoredPick[]; steal?: boolean }) {
  return (
    <ul className="mr-dr-movers">
      {picks.map((p) => (
        <li key={p.pick}>
          <span className="mr-dr-mover-head">
            <Verdict badge={p.badge}>{steal ? 'Steal' : undefined}</Verdict>
            <b>{p.player_name}</b>
          </span>
          <span className="mr-meta">
            pick {p.pick} → value {valueTag(p)} · {p.team_name}
          </span>
        </li>
      ))}
    </ul>
  )
}

const ALL = 'all'

function AllPicks({
  picks,
  teamColumns,
  sortCol,
  sortAsc,
  onSort,
  teamFilter,
  onTeamFilterChange,
  myTeamId,
  isMyTeam,
}: Props & { myTeamId: number | null; isMyTeam: (id: number | null | undefined) => boolean }) {
  const teamOptions = useMemo(
    () => [
      { value: ALL, label: 'All teams' },
      ...leadWithMyTeam(teamColumns, myTeamId).map((t) => ({
        value: String(t.team_id),
        label: fantasyTeamOptionLabel(t.team_name, isMyTeam(t.team_id)),
      })),
    ],
    [teamColumns, myTeamId, isMyTeam],
  )

  const sort: SortState = { key: sortCol, dir: sortAsc ? 'asc' : 'desc' }
  const columns: Column<ScoredPick>[] = [
    { key: 'player', header: 'Player', align: 'left', pinned: true, cell: (p) => p.player_name },
    { key: 'pick', header: 'Pick', align: 'center', sortable: true, firstDir: 'asc', cell: (p) => <span className="mr-num">{p.pick}</span> },
    { key: 'round', header: 'Rd', align: 'center', cell: (p) => <span className="mr-num">{p.round}</span> },
    { key: 'team', header: 'Team', align: 'left', cell: (p) => <span className="mr-dr-nowrap">{p.team_name}</span> },
    { key: 'gp', header: 'GP', cell: (p) => <span className="mr-num">{p.gp ?? '—'}</span> },
    { key: 'mpg', header: 'MPG', cell: (p) => <span className="mr-num">{p.mpg !== null ? p.mpg.toFixed(1) : '—'}</span> },
    { key: 'z', header: 'zTotal', cell: (p) => <span className="mr-num">{p.totalZ !== null ? p.totalZ.toFixed(2) : '—'}</span> },
    { key: 'valueRank', header: 'Value', sortable: true, firstDir: 'asc', cell: (p) => <span className="mr-num mr-dr-nowrap">{valueTag(p)}</span> },
    {
      key: 'diff',
      header: 'Diff',
      sortable: true,
      firstDir: 'asc',
      cell: (p) =>
        p.valueRank !== null && p.diff !== null ? (
          <b className={`mr-num ${toneCls(p.diff)}`}>{p.diff > 0 ? `+${p.diff}` : p.diff}</b>
        ) : (
          <b className="mr-dr-neg">—</b>
        ),
    },
    { key: 'verdict', header: 'Verdict', align: 'left', cell: (p) => <Verdict badge={p.badge} /> },
  ]

  return (
    <Card title="All Picks">
      <SelectSheet
        id="draft-team"
        label="Team"
        options={teamOptions}
        value={teamFilter === null ? ALL : String(teamFilter)}
        onChange={(v) => onTeamFilterChange(v === ALL ? null : Number(v))}
        wide
      />
      <DataTable
        caption="All picks"
        columns={columns}
        rows={picks}
        rowKey={(p) => String(p.pick)}
        sort={sort}
        onSortChange={(s) => onSort(s.key as SortCol, s.dir === 'asc')}
        isHighlighted={(p) => isMyTeam(p.team_id)}
        maxHeight={560}
      />
    </Card>
  )
}

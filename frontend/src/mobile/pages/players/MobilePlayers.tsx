import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type {
  ComparisonOperator,
  CustomDateRange,
  Player,
  PlayerFilters,
  PlayerMatchup,
  PlayerStatKey,
  ScheduleResponse,
  StatFilter,
  TimePeriod,
} from '../../../types/api'
import { CoverageNotice } from '../../../components/DateRangePicker'
import { MatchupCell, MatchupExpandRow } from '../../../components/MatchupDisplay'
import { WeekDayHeading, WeekOpponent, SCHEDULE_HORIZONS, type PlayerTableMode, type ScheduleHorizon } from '../../../components/PlayerWeekColumns'
import PlayerNameLink from '../../../components/PlayerNameLink'
import { useMyTeam } from '../../../context/useMyTeam'
import { fantasyTeamOptionLabel, leadWithMyTeam } from '../../../myTeam/display'
import { easternToday, opponentsByTeamDate, weekGameCount, weekOpponent, weekScheduleDays } from '../../../utils/slateWindow'
import { FF_PAST_SLATES } from '../../../config/featureFlags'
import {
  ActiveFilterChips,
  Card,
  Chip,
  ChipRow,
  DataTable,
  FilterGroup,
  FilterSearchRow,
  FiltersSheet,
  PeriodChips,
  Segmented,
  StatusPill,
  PositionFilter,
  useSheetHistory,
  type ActiveFilter,
  type Column,
  type SortState,
} from '../../ui'
import { ensureMobileFonts } from '../../fonts'
import '../../mobile.css'
import './players.css'

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'] as const
const STATUS_OPTIONS = [
  { value: 'ONTEAM', label: 'On Team' },
  { value: 'FREEAGENT', label: 'Free Agent' },
  { value: 'WAIVERS', label: 'Waivers' },
] as const

const STAT_OPTIONS: { value: PlayerStatKey; label: string }[] = [
  { value: 'minutes', label: 'Minutes' },
  { value: 'pts', label: 'PTS' },
  { value: 'reb', label: 'REB' },
  { value: 'ast', label: 'AST' },
  { value: 'stl', label: 'STL' },
  { value: 'blk', label: 'BLK' },
  { value: 'fg_percentage', label: 'FG%' },
  { value: 'ft_percentage', label: 'FT%' },
  { value: 'three_pm', label: '3PM' },
]
const OPERATOR_OPTIONS: { value: ComparisonOperator; label: string }[] = [
  { value: 'eq', label: '=' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '>=' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '<=' },
]
const statLabel = (k: PlayerStatKey) => STAT_OPTIONS.find((o) => o.value === k)?.label ?? k.toUpperCase()
const opLabel = (o: ComparisonOperator) => OPERATOR_OPTIONS.find((x) => x.value === o)?.label ?? o

export interface MobilePlayersProps {
  isLoading: boolean
  error: unknown
  players: Player[]
  actualStart?: string
  actualEnd?: string
  filters: PlayerFilters
  setFilters: Dispatch<SetStateAction<PlayerFilters>>
  teams?: Array<{ team_id: number; team_name: string }>
  teamMap: Map<number, string>
  showAverages: boolean
  setShowAverages: (v: boolean) => void
  timePeriod: TimePeriod
  setTimePeriod: (v: TimePeriod) => void
  customRange: CustomDateRange | null
  setCustomRange: (v: CustomDateRange | null) => void
  integerMode: boolean
  setIntegerMode: (v: boolean) => void
  tableMode: PlayerTableMode
  setTableMode: (v: PlayerTableMode) => void
  scheduleHorizon: ScheduleHorizon
  setScheduleHorizon: (v: ScheduleHorizon) => void
  slateDate: string
  setSlateDate: (v: string) => void
  upcomingDates: string[]
  pastDates: string[]
  currentSlateDate: string | null | undefined
  selectedSlateDate: string
  slateUsable: boolean
  playingOnSlateOnly: boolean
  setPlayingOnSlateOnly: (v: boolean) => void
  matchupMap: Map<string, PlayerMatchup>
  schedule: ScheduleResponse | undefined
}

const isPct = (k: string) => k === 'fg_percentage' || k === 'ft_percentage'

function teamDisplayFor(pl: Player, teamMap: Map<number, string>): string {
  if (pl.status === 'ONTEAM' && pl.team_id !== 0) return teamMap.get(pl.team_id) || 'Unknown Team'
  if (pl.status === 'FREEAGENT') return 'Free Agent'
  if (pl.status === 'WAIVERS') return 'Waivers'
  return 'Unknown'
}

function perGameValue(pl: Player, k: PlayerStatKey, showAverages: boolean): number {
  return showAverages && k !== 'gp' && !isPct(k) ? (pl.stats.gp > 0 ? pl.stats[k] / pl.stats.gp : 0) : pl.stats[k]
}

/**
 * Players on a phone (mobile redesign, step 4). Same data, filters and URL
 * state as the desktop page (Players.tsx owns them); this is only the layout:
 * search + Filters sheet + active-filter chips, "Showing N players",
 * Stats/Schedule and Per Game/Totals, period chips, and the table with the
 * name pinned and the text columns (NBA, Pos, Team) after the stats.
 */
export default function MobilePlayers(p: MobilePlayersProps) {
  useEffect(() => ensureMobileFonts(), [])
  const sheet = useSheetHistory('filters')
  const { myTeamId, isMyTeam } = useMyTeam()
  const [sort, setSort] = useState<SortState | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [draft, setDraft] = useState<{ stat: PlayerStatKey | ''; operator: ComparisonOperator | ''; value: string }>({ stat: '', operator: '', value: '' })

  const { filters, setFilters, showAverages, tableMode } = p
  const showSchedule = tableMode === 'schedule'
  const weekDays = useMemo(() => weekScheduleDays(easternToday(), p.scheduleHorizon), [p.scheduleHorizon])
  const opponents = useMemo(() => (p.schedule ? opponentsByTeamDate(p.schedule) : new Map<string, string>()), [p.schedule])

  const teamMap = p.teamMap
  const teamDisplay = (pl: Player) => teamDisplayFor(pl, teamMap)

  const fmt = (pl: Player, k: PlayerStatKey) => {
    const v = pl.stats[k]
    if (isPct(k)) return v.toFixed(3).replace(/^0(?=\.)/, '')
    if (showAverages) return pl.stats.gp > 0 ? (v / pl.stats.gp).toFixed(1) : '0.0'
    return v.toFixed(0)
  }

  const rows = useMemo(() => {
    if (!sort) return p.players
    const val = (pl: Player): string | number => {
      if (sort.key === 'player_name') return pl.player_name
      if (sort.key === 'pro_team') return pl.pro_team
      if (sort.key === 'team_id') return teamDisplayFor(pl, teamMap)
      if (sort.key === 'week_games') return weekGameCount(opponents, pl.pro_team, weekDays)
      if (sort.key in pl.stats) return perGameValue(pl, sort.key as PlayerStatKey, showAverages)
      return 0
    }
    return [...p.players].sort((a, b) => {
      const av = val(a)
      const bv = val(b)
      return sort.dir === 'asc' ? (av > bv ? 1 : -1) : av < bv ? 1 : -1
    })
  }, [p.players, sort, showAverages, opponents, weekDays, teamMap])

  // ── filters ──
  const set = (patch: Partial<PlayerFilters>) => setFilters((f) => ({ ...f, ...patch }))
  const toggleIn = (list: string[] | undefined, v: string) => (list?.includes(v) ? list.filter((x) => x !== v) : [...(list ?? []), v])
  const teamLabel = (id: number) => (id === 0 ? 'Free Agents / Waivers' : p.teamMap.get(id) ?? `Team ${id}`)
  const slateLabel = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  const active: ActiveFilter[] = []
  if (filters.team_id !== null && filters.team_id !== undefined)
    active.push({ key: 'team', label: teamLabel(filters.team_id), onRemove: () => set({ team_id: null }) })
  for (const pos of filters.positions ?? []) active.push({ key: `pos-${pos}`, label: pos, onRemove: () => set({ positions: (filters.positions ?? []).filter((x) => x !== pos) }) })
  if (filters.status?.length)
    active.push({
      key: 'status',
      label: filters.status.map((s) => STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s).join(' · '),
      onRemove: () => set({ status: [] }),
    })
  ;(filters.stat_filters ?? []).forEach((f, i) =>
    active.push({
      key: `sf${i}`,
      label: `${statLabel(f.stat)} ${opLabel(f.operator)} ${f.value}`,
      onRemove: () => set({ stat_filters: (filters.stat_filters ?? []).filter((_, j) => j !== i) }),
    }),
  )
  if (p.slateDate) active.push({ key: 'slate', label: `Slate ${slateLabel(p.slateDate)}`, onRemove: () => p.setSlateDate('') })
  if (p.playingOnSlateOnly) active.push({ key: 'onslate', label: 'Only playing on slate', onRemove: () => p.setPlayingOnSlateOnly(false) })

  const reset = () => {
    setFilters((f) => ({ ...f, positions: [], status: [], team_id: null, stat_filters: [] }))
    p.setSlateDate('')
    p.setPlayingOnSlateOnly(false)
    setDraft({ stat: '', operator: '', value: '' })
  }

  const draftValue = Number(draft.value)
  const canAdd = draft.stat !== '' && draft.operator !== '' && draft.value.trim() !== '' && Number.isFinite(draftValue)
  const addStatFilter = () => {
    if (!canAdd) return
    const next: StatFilter = { stat: draft.stat as PlayerStatKey, operator: draft.operator as ComparisonOperator, value: draftValue }
    set({ stat_filters: [...(filters.stat_filters ?? []), next] })
    setDraft({ stat: '', operator: '', value: '' })
  }

  // ── table ──
  const toggleExpand = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  const nameCol: Column<Player> = {
    key: 'player_name',
    header: 'NAME',
    headerLabel: 'Name',
    pinned: true,
    sortable: true,
    firstDir: 'asc',
    className: 'mr-pl-name',
    cell: (pl) => {
      const status = p.matchupMap.get(pl.player_name)?.injury_status
      return (
        <>
          <PlayerNameLink name={pl.player_name} playerId={pl.player_id} className="mr-pl-link" />
          {status && (
            <span className="mr-pl-status">
              <StatusPill status={status} />
            </span>
          )}
        </>
      )
    },
  }
  const noData = (pl: Player) => pl.has_data === false
  const stat = (key: PlayerStatKey, avg: string, tot: string): Column<Player> => ({
    key,
    header: showAverages ? avg : tot,
    sortable: true,
    cell: (pl) => (noData(pl) ? <span className="mr-pl-nodata" title="Not available for a custom range — try Last 7/15/30/Season">—</span> : fmt(pl, key)),
  })
  const textCols: Column<Player>[] = [
    { key: 'pro_team', header: 'NBA', headerLabel: 'NBA Team', align: 'left', sortable: true, firstDir: 'asc', cell: (pl) => pl.pro_team },
    { key: 'pos', header: 'POS', headerLabel: 'Position', align: 'left', cell: (pl) => pl.positions.join(', ') },
    { key: 'team_id', header: 'TEAM', headerLabel: 'Fantasy team', align: 'left', sortable: true, firstDir: 'asc', cell: teamDisplay },
  ]

  const columns: Column<Player>[] = showSchedule
    ? [
        nameCol,
        ...weekDays.map<Column<Player>>((day) => ({
          key: `d-${day.date}`,
          header: <WeekDayHeading day={day} />,
          headerLabel: `${day.weekday} ${day.label}`,
          align: 'center',
          className: day.date === p.selectedSlateDate ? 'mr-pl-sel' : undefined,
          cell: (pl) => <WeekOpponent opponent={weekOpponent(opponents, pl.pro_team, day.date)} />,
        })),
        { key: 'week_games', header: 'Games', align: 'center', sortable: true, cell: (pl) => <b>{weekGameCount(opponents, pl.pro_team, weekDays)}</b> },
        ...textCols,
      ]
    : [
        nameCol,
        {
          ...stat('minutes', 'MPG', 'MIN'),
          cell: (pl) => (noData(pl) ? <span className="mr-pl-nodata" title="Not available for a custom range — try Last 7/15/30/Season">No data for this range</span> : fmt(pl, 'minutes')),
        },
        stat('fg_percentage', 'FG%', 'FG%'),
        stat('ft_percentage', 'FT%', 'FT%'),
        stat('three_pm', '3PG', '3PM'),
        stat('reb', 'RPG', 'REB'),
        stat('ast', 'APG', 'AST'),
        stat('stl', 'SPG', 'STL'),
        stat('blk', 'BPG', 'BLK'),
        stat('pts', 'PPG', 'PTS'),
        { key: 'gp', header: 'GP', sortable: true, cell: (pl) => (noData(pl) ? '—' : pl.stats.gp) },
        {
          key: 'matchup',
          header: 'MATCHUP',
          headerLabel: 'Matchup',
          align: 'left',
          cell: (pl) => (
            <MatchupCell
              matchup={p.matchupMap.get(pl.player_name)}
              isExpanded={expanded.has(pl.player_name)}
              onToggle={() => toggleExpand(pl.player_name)}
              playerStats={pl.stats}
            />
          ),
        },
        ...textCols,
      ]

  const maxHeight = typeof window !== 'undefined' ? Math.max(360, window.innerHeight - 140) : undefined

  return (
    <div className="mr-root mr-page mr-players">
      <h1 className="mr-h1">Players</h1>

      <FilterSearchRow
        search={filters.search ?? ''}
        onSearchChange={(search) => set({ search })}
        activeCount={active.length}
        onOpenFilters={sheet.show}
        filtersOpen={sheet.open}
      />
      <ActiveFilterChips active={active} idle={['All Teams', 'All positions', 'All status']} onOpen={sheet.show} />

      <span className="mr-meta" aria-live="polite">
        Showing {p.players.length} players
      </span>

      <div className="mr-two">
        <Segmented
          label="Table"
          value={tableMode === 'schedule' ? 'schedule' : 'stats'}
          onChange={(v) => p.setTableMode(v)}
          options={[
            { value: 'stats', label: 'Stats' },
            { value: 'schedule', label: 'Schedule' },
          ]}
        />
        {showSchedule ? (
          <Segmented
            label="Schedule horizon"
            value={String(p.scheduleHorizon)}
            onChange={(v) => p.setScheduleHorizon(Number(v) as ScheduleHorizon)}
            options={SCHEDULE_HORIZONS.map((d) => ({ value: String(d), label: `${d} days` }))}
          />
        ) : (
          <Segmented
            label="Per Game or Totals"
            value={showAverages ? 'avg' : 'tot'}
            onChange={(v) => p.setShowAverages(v === 'avg')}
            options={[
              { value: 'avg', label: 'Per Game' },
              { value: 'tot', label: 'Totals' },
            ]}
          />
        )}
      </div>

      {!showSchedule && (
        <PeriodChips value={p.timePeriod} onChange={p.setTimePeriod} customRange={p.customRange} onCustomRangeChange={p.setCustomRange} />
      )}

      {!showSchedule && p.timePeriod === 'custom' && p.customRange && (
        <CoverageNotice requestedStart={p.customRange.start} requestedEnd={p.customRange.end} actualStart={p.actualStart} actualEnd={p.actualEnd} />
      )}

      {p.isLoading ? (
        <Card>
          <p className="mr-meta" role="status">Loading players...</p>
        </Card>
      ) : p.error ? (
        <Card>
          <p className="mr-pl-error" role="alert">Error loading players</p>
        </Card>
      ) : (
        <DataTable
          caption="Players"
          className="mq-scroll-container mr-pl-table"
          columns={columns}
          rows={rows}
          rowKey={(pl) => String(pl.player_id ?? pl.player_name)}
          sort={sort}
          onSortChange={setSort}
          maxHeight={maxHeight}
          empty={<span className="mr-pl-empty">No players match these filters</span>}
          renderAfterRow={(pl) => {
            const m = p.matchupMap.get(pl.player_name)
            return !showSchedule && m && expanded.has(pl.player_name) ? (
              <MatchupExpandRow matchup={m} colSpan={columns.length} integerMode={p.integerMode} />
            ) : null
          }}
        />
      )}

      <FiltersSheet open={sheet.open} onClose={sheet.hide} onReset={reset}>
        <FilterGroup label="Team">
          <ChipRow label="Team" wrap>
            <Chip selected={filters.team_id === null || filters.team_id === undefined} onClick={() => set({ team_id: null })}>
              All Teams
            </Chip>
            <Chip selected={filters.team_id === 0} onClick={() => set({ team_id: 0 })}>
              Free Agents / Waivers
            </Chip>
            {leadWithMyTeam(p.teams ?? [], myTeamId).map((t) => (
              <Chip key={t.team_id} selected={filters.team_id === t.team_id} onClick={() => set({ team_id: t.team_id })}>
                {fantasyTeamOptionLabel(t.team_name, isMyTeam(t.team_id))}
              </Chip>
            ))}
          </ChipRow>
        </FilterGroup>

        <PositionFilter options={POSITIONS} selected={filters.positions ?? []} onChange={(positions) => set({ positions })} />

        <FilterGroup label="Status" hint="none = all">
          <ChipRow label="Status" wrap>
            {STATUS_OPTIONS.map((s) => (
              <Chip key={s.value} selected={!!filters.status?.includes(s.value)} onClick={() => set({ status: toggleIn(filters.status, s.value) })}>
                {s.label}
              </Chip>
            ))}
          </ChipRow>
        </FilterGroup>

        <FilterGroup label="Stat filter">
          <div className="mr-pl-statrow">
            <select className="mr-field" aria-label="Filter by stat" value={draft.stat} onChange={(e) => setDraft((d) => ({ ...d, stat: e.target.value as PlayerStatKey | '' }))}>
              <option value="">Filter by stat</option>
              {STAT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              className="mr-field mr-pl-op"
              aria-label="Operator"
              value={draft.operator}
              onChange={(e) => setDraft((d) => ({ ...d, operator: e.target.value as ComparisonOperator | '' }))}
            >
              <option value="">Operator</option>
              {OPERATOR_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              className="mr-field mr-pl-val"
              type="number"
              inputMode="decimal"
              step="0.1"
              placeholder="Value"
              aria-label="Stat value"
              value={draft.value}
              onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value }))}
            />
          </div>
          <button type="button" className="mr-btn mr-sm" onClick={addStatFilter} disabled={!canAdd}>
            + Add Filter
          </button>
          {(filters.stat_filters?.length ?? 0) > 0 && (
            <ChipRow label="Stat filters" wrap>
              {(filters.stat_filters ?? []).map((f, i) => (
                <Chip
                  key={`${f.stat}-${f.operator}-${f.value}-${i}`}
                  selected
                  removable
                  aria-label={`Remove filter ${statLabel(f.stat)} ${opLabel(f.operator)} ${f.value}`}
                  onClick={() => set({ stat_filters: (filters.stat_filters ?? []).filter((_, j) => j !== i) })}
                >
                  {statLabel(f.stat)} {opLabel(f.operator)} {f.value}
                </Chip>
              ))}
            </ChipRow>
          )}
        </FilterGroup>

        <FilterGroup label="Slate">
          <ChipRow label="Slate" wrap>
            <Chip selected={p.slateDate === ''} onClick={() => p.setSlateDate('')}>
              {p.currentSlateDate
                ? `Upcoming (live) — ${p.currentSlateDate}`
                : p.currentSlateDate === null
                  ? 'Upcoming (live) — no games scheduled'
                  : 'Upcoming (live)'}
            </Chip>
            {p.upcomingDates.map((d) => (
              <Chip key={d} selected={p.slateDate === d} onClick={() => p.setSlateDate(d)}>
                {d}
              </Chip>
            ))}
          </ChipRow>
          {FF_PAST_SLATES && p.pastDates.length > 0 && (
            <select
              className="mr-field"
              aria-label="Past slate (debug)"
              value={p.pastDates.includes(p.slateDate) ? p.slateDate : ''}
              onChange={(e) => p.setSlateDate(e.target.value)}
            >
              <option value="">Past (debug)…</option>
              {p.pastDates.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          )}
        </FilterGroup>

        <FilterGroup label="Options">
          <ChipRow label="Options" wrap>
            <Chip
              selected={p.playingOnSlateOnly}
              disabled={!p.slateUsable}
              title="Keep only players whose NBA team plays on the selected slate."
              onClick={() => p.setPlayingOnSlateOnly(!p.playingOnSlateOnly)}
            >
              Only playing on slate
            </Chip>
            <Chip selected={p.integerMode} onClick={() => p.setIntegerMode(!p.integerMode)}>
              Integer projections
            </Chip>
          </ChipRow>
        </FilterGroup>
      </FiltersSheet>
    </div>
  )
}

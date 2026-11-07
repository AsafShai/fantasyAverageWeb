import { useMemo, useState, type ReactNode } from 'react'
import TrendGameLogChart from '../../components/TrendGameLogChart'
import { BASELINE_LABEL } from '../../utils/trendBaseline'
import { formatShort } from '../../utils/dateRange'
import { isGoodChange } from '../../utils/categoryTrends'
import { fantasyTeamOptionLabel } from '../../myTeam/display'
import type {
  CategoryMoverItem, CategoryStatItem, CountingCategory, MinutesMoverItem, RegressionMode, RegressionPlayerGroup,
  RegressionStat, RegressionStatItem, UsageRoleItem,
} from '../../types/api'
import {
  ALL_POSITIONS, BASELINE_OPTIONS, CAT_SORT_VAL, FORM_BASELINE_OPTIONS, MAKES_LABEL, MIN_SORT_VAL, OWNERSHIP_OPTIONS,
  TABS, USG_SORT_VAL, WINDOW_OPTIONS, filterAndSort, normalizeDelta, passesShared, sortRegressionGroups,
  type CategoryRow, type Filters, type Ownership, type StatFilter, type TabKey,
} from '../../utils/trendsShared'
import {
  ActiveFilterChips, Card, Chip, ChipRow, DataTable, FilterGroup, FilterSearchRow, FiltersSheet, PositionFilter, Segmented,
  useSheetHistory, type ActiveFilter, type Column, type SortState,
} from '../ui'
import './trends.css'

export interface MobileTrendsProps {
  tab: TabKey
  setTab: (t: TabKey) => void
  isLoading: boolean
  errorMessage: string | null
  filters: Filters
  setSearch: (v: string) => void
  positions: string[]
  setPositions: (v: string[]) => void
  setOwnership: (v: Ownership) => void
  fantasyTeam: string | null
  setFantasyTeam: (v: string | null) => void
  teamOptions: string[]
  myTeamName: string | undefined
  minGames: number
  setMinGames: (n: number) => void
  minGamesFloor: number
  minGamesOptions: number[]
  windowDays: number
  customStartIso: string | null
  selectPreset: (d: number) => void
  customOpen: boolean
  toggleCustom: () => void
  /** The page's date picker for a custom window start. */
  customPanel: ReactNode
  gameNights: number | null
  eligibilityRule: string | null
  isShootingSeasonTab: boolean
  // data per tab
  minutes?: MinutesMoverItem[]
  usage?: UsageRoleItem[]
  categories?: CategoryMoverItem[]
  leagueCats: CountingCategory[]
  reverseCats: ReadonlySet<string>
  activeCategory: CountingCategory
  setCategory: (c: CountingCategory) => void
  regression?: { items: RegressionPlayerGroup[]; mode: RegressionMode; baseline_seasons: number }
  isShooting: boolean
  isFormTab: boolean
  baselineSeasons: number
  setBaselineSeasons: (n: number) => void
}

const signed = (n: number, digits = 1) => `${n >= 0 ? '+' : ''}${n.toFixed(digits)}`

/** ▲/▼ with the sign; green when good, red when bad. */
function Change({ value, unit = '', digits = 1, good }: { value: number; unit?: string; digits?: number; good?: boolean }) {
  const up = value >= 0
  const ok = good ?? up
  return (
    <span className={`mr-tr-delta ${ok ? 'mr-tr-good' : 'mr-tr-bad'}`}>
      {up ? '▲' : '▼'} {signed(value, digits)}{unit}
    </span>
  )
}

function Owner({ status }: { status: string }) {
  return status === 'FA' ? <span className="mr-pill mr-fa mr-pill-fa">FA</span> : <span className="mr-tr-owner">{status}</span>
}

const Partial = () => <span className="mr-pill mr-pill-bench mr-tr-partial">partial</span>

interface ShootRow {
  group: RegressionPlayerGroup
  stat: RegressionStatItem
  first: boolean
  siblings: RegressionStat[]
}

/**
 * Player Trends on a phone: tab chips, search + Filters sheet, 7d/15d/30d/Custom
 * window and All / Free agents / Rostered scope, then a table with the player
 * pinned. Tapping a player opens their game-by-game chart in a card above the
 * table. Trends.tsx keeps all state and data.
 */
export default function MobileTrends(p: MobileTrendsProps) {
  const sheet = useSheetHistory('filters')
  const [sort, setSort] = useState<SortState>({ key: 'delta', dir: 'desc' })
  const [selected, setSelected] = useState<{ id: number; name: string; stat?: RegressionStat } | null>(null)
  const [statFilter, setStatFilter] = useState<StatFilter>('all')
  const w = p.windowDays
  const asc = sort.dir === 'asc'

  const pickTab = (t: TabKey) => {
    p.setTab(t)
    setSelected(null)
    setSort({ key: t === 'shooting-form' ? 'z' : t.startsWith('shooting') ? 'dev' : 'delta', dir: 'desc' })
  }
  const onSort = (s: SortState) => setSort(s)
  const pass = <T extends { player_name: string; position: string; fantasy_status: string; games_last_15d: number }>(r: T) => passesShared(r, p.filters)

  const open = (id: number, name: string, stat?: RegressionStat) =>
    setSelected((cur) => (cur && cur.id === id && cur.stat === stat ? null : { id, name, stat }))

  const nameCell = (id: number, name: string, extra?: ReactNode, stat?: RegressionStat) => (
    <button type="button" className="mr-tr-name" aria-expanded={selected?.id === id} onClick={() => open(id, name, stat)}>
      {name}
      {extra}
    </button>
  )
  const sortable = (key: string, header: ReactNode, headerLabel: string): Pick<Column<never>, 'key' | 'header' | 'headerLabel' | 'sortable'> => ({
    key, header, headerLabel, sortable: true,
  })

  // ---- tables --------------------------------------------------------------
  let table: ReactNode = null
  let noneQualify = false
  if (p.tab === 'minutes' && p.minutes) {
    const rows = filterAndSort(p.minutes, pass, MIN_SORT_VAL[sort.key] ?? MIN_SORT_VAL.delta, asc)
    noneQualify = p.minutes.length === 0
    const cols: Column<MinutesMoverItem>[] = [
      { ...sortable('player', 'PLAYER', 'Player'), pinned: true, align: 'left', cell: (r) => nameCell(r.player_id, r.player_name, r.low_sample && <Partial />) },
      { ...sortable('team', 'TEAM', 'Team'), align: 'left', cell: (r) => r.pro_team },
      { ...sortable('pos', 'POS', 'Position'), align: 'left', cell: (r) => r.position },
      { ...sortable('season', 'SEASON MPG', 'Season minutes per game'), cell: (r) => r.season_mpg.toFixed(1) },
      { ...sortable('l5', `${w}D MPG`, `Last ${w} days minutes per game`), cell: (r) => r.l5_mpg.toFixed(1) },
      { ...sortable('delta', 'Δ MPG', 'Change in minutes per game vs season'), cell: (r) => <Change value={r.delta_mpg} /> },
      { ...sortable('gp', 'GP', 'Games played'), cell: (r) => r.season_gp },
      { ...sortable('g15', `G(${w}D)`, `Games in the last ${w} days`), cell: (r) => r.games_last_15d },
      { key: 'owner', header: 'OWNER', headerLabel: 'Fantasy owner', align: 'left', cell: (r) => <Owner status={r.fantasy_status} /> },
    ]
    table = <DataTable caption="Minutes movers" columns={cols} rows={rows} rowKey={(r) => String(r.player_id)} sort={sort} onSortChange={onSort}
      isHighlighted={(r) => selected?.id === r.player_id} empty={<span className="mr-tr-empty">{noneQualify ? 'No players qualify yet.' : 'No players match current filters.'}</span>} />
  } else if (p.tab === 'usage' && p.usage) {
    const rows = filterAndSort(p.usage, pass, USG_SORT_VAL[sort.key] ?? USG_SORT_VAL.delta, asc)
    noneQualify = p.usage.length === 0
    const cols: Column<UsageRoleItem>[] = [
      { ...sortable('player', 'PLAYER', 'Player'), pinned: true, align: 'left', cell: (r) => nameCell(r.player_id, r.player_name) },
      { ...sortable('team', 'TEAM', 'Team'), align: 'left', cell: (r) => r.pro_team },
      { ...sortable('season', 'SEASON USG%', 'Season usage'), cell: (r) => `${r.season_usg.toFixed(1)}%` },
      { ...sortable('l5', `${w}D USG%`, `Last ${w} days usage`), cell: (r) => `${r.l5_usg.toFixed(1)}%` },
      { ...sortable('delta', 'Δ USG', 'Change in usage vs season'), cell: (r) => <Change value={r.delta_usg} unit="%" /> },
      { ...sortable('dmpg', 'Δ MPG', 'Change in minutes per game'), cell: (r) => `${signed(r.delta_mpg)}mpg` },
      { ...sortable('g15', `G(${w}D)`, `Games in the last ${w} days`), cell: (r) => r.games_last_15d },
      {
        key: 'role', header: 'ROLE', headerLabel: 'Role change', align: 'left',
        cell: (r) => r.role_badge
          ? <span className={`mr-pill mr-square ${r.role_badge.includes('↑') ? 'mr-pill-starter' : 'mr-pill-out'}`}>{r.role_badge}</span>
          : '—',
      },
      { key: 'owner', header: 'OWNER', headerLabel: 'Fantasy owner', align: 'left', cell: (r) => <Owner status={r.fantasy_status} /> },
    ]
    table = <DataTable caption="Usage and role" columns={cols} rows={rows} rowKey={(r) => String(r.player_id)} sort={sort} onSortChange={onSort}
      isHighlighted={(r) => selected?.id === r.player_id} empty={<span className="mr-tr-empty">{noneQualify ? 'No players qualify yet.' : 'No players match current filters.'}</span>} />
  } else if (p.tab === 'categories' && p.categories) {
    const flagged: CategoryRow[] = p.categories.flatMap((item) => {
      const stat = item.stats.find((s: CategoryStatItem) => s.cat === p.activeCategory)
      return stat?.flagged ? [{ item, stat }] : []
    })
    noneQualify = flagged.length === 0
    const rows = filterAndSort(flagged, (r) => passesShared(r.item, p.filters), CAT_SORT_VAL[sort.key] ?? CAT_SORT_VAL.delta, asc)
    const cat = p.activeCategory
    const cols: Column<CategoryRow>[] = [
      { ...sortable('player', 'PLAYER', 'Player'), pinned: true, align: 'left', cell: (r) => nameCell(r.item.player_id, r.item.player_name, r.item.low_sample && <Partial />, undefined) },
      { ...sortable('team', 'TEAM', 'Team'), align: 'left', cell: (r) => r.item.pro_team },
      { ...sortable('season', `SEASON ${cat}`, `Season ${cat} per game`), cell: (r) => r.stat.season_avg.toFixed(1) },
      { ...sortable('l5', `${w}D ${cat}`, `Last ${w} days ${cat} per game`), cell: (r) => r.stat.window_avg.toFixed(1) },
      { ...sortable('delta', `Δ ${cat}`, `Change in ${cat} vs season`), cell: (r) => <Change value={r.stat.delta} good={isGoodChange(r.stat.delta, cat, p.reverseCats)} /> },
      { ...sortable('dmpg', 'Δ MPG', 'Change in minutes per game'), cell: (r) => `${signed(r.item.window_mpg - r.item.season_mpg)}mpg` },
      { ...sortable('g15', `G(${w}D)`, `Games in the last ${w} days`), cell: (r) => r.item.games_last_15d },
      { key: 'owner', header: 'OWNER', headerLabel: 'Fantasy owner', align: 'left', cell: (r) => <Owner status={r.item.fantasy_status} /> },
    ]
    table = <DataTable caption={`${cat} movers`} columns={cols} rows={rows} rowKey={(r) => String(r.item.player_id)} sort={sort} onSortChange={onSort}
      isHighlighted={(r) => selected?.id === r.item.player_id} empty={<span className="mr-tr-empty">{noneQualify ? 'No players qualify yet.' : 'No players match current filters.'}</span>} />
  } else if (p.isShooting && p.regression) {
    const isForm = p.regression.mode === 'form'
    const groups = sortRegressionGroups(p.regression.items, p.filters, statFilter, sort.key, asc, isForm)
    noneQualify = p.regression.items.length === 0
    const rows: ShootRow[] = groups.flatMap(({ group, stats }) =>
      stats.map((stat, i) => ({ group, stat, first: i === 0, siblings: stats.map((s) => s.stat) })))
    const cols: Column<ShootRow>[] = [
      { ...sortable('player', 'PLAYER', 'Player'), pinned: true, align: 'left', cell: (r) => (r.first ? nameCell(r.group.player_id, r.group.player_name, undefined, r.stat.stat) : <span className="mr-tr-sub">↳</span>) },
      { ...sortable('team', 'TEAM', 'Team'), align: 'left', cell: (r) => (r.first ? r.group.pro_team : '') },
      { ...sortable('g15', `G(${w}D)`, `Games in the last ${w} days`), cell: (r) => (r.first ? r.group.games_last_15d : '') },
      { ...sortable('stat', 'STAT', 'Shooting category'), align: 'left', cell: (r) => (
        <button type="button" className="mr-tr-stat" aria-expanded={selected?.id === r.group.player_id && selected.stat === r.stat.stat} onClick={() => open(r.group.player_id, r.group.player_name, r.stat.stat)}>{r.stat.stat}</button>
      ) },
      { ...sortable('cur', isForm ? `LAST ${w}D %` : 'SEASON%', isForm ? `Last ${w} days percentage` : 'Season percentage'), cell: (r) => `${r.stat.current_pct.toFixed(1)}%` },
      { ...sortable('base', isForm ? 'BASELINE %' : `BASELINE (${BASELINE_LABEL[p.baselineSeasons]})`, 'Baseline percentage'), cell: (r) => `${r.stat.baseline_pct.toFixed(1)}%` },
      { ...sortable('dev', isForm ? 'GAP' : 'Δ VS BASELINE', 'Gap to baseline'), cell: (r) => <Change value={r.stat.dev} unit="%" /> },
      ...(isForm ? [{ ...sortable('z', 'Z', 'z-score'), cell: (r: ShootRow) => (r.stat.z === null ? '—' : signed(r.stat.z, 2)) } as Column<ShootRow>] : []),
      { ...sortable('att', 'ATT/G', 'Attempts per game'), cell: (r) => r.stat.attempts_per_game.toFixed(1) },
      {
        ...sortable(isForm ? 'impact' : 'drift', 'IF IT NORMALIZES', 'Makes per game if it normalizes'),
        cell: (r) => {
          const d = normalizeDelta(r.stat)
          return <span className={d >= 0 ? 'mr-tr-good' : 'mr-tr-bad'}>{signed(d, 2)} {MAKES_LABEL[r.stat.stat]}/g</span>
        },
      },
      { key: 'owner', header: 'OWNER', headerLabel: 'Fantasy owner', align: 'left', cell: (r) => (r.first ? <Owner status={r.group.fantasy_status} /> : '') },
    ]
    table = <DataTable caption="Shooting trends" columns={cols} rows={rows} rowKey={(r) => `${r.group.player_id}-${r.stat.stat}`} sort={sort} onSortChange={onSort}
      isHighlighted={(r) => selected?.id === r.group.player_id && selected.stat === r.stat.stat}
      empty={<span className="mr-tr-empty">{noneQualify ? 'No players qualify yet.' : 'No players match current filters.'}</span>} />
  }

  // ---- chart card ----------------------------------------------------------
  const shootingStats = useMemo(
    () => (selected && p.isShooting && p.regression
      ? p.regression.items.find((g) => g.player_id === selected.id)?.stats.map((s) => s.stat) ?? []
      : []),
    [selected, p.isShooting, p.regression],
  )
  const [catOverride, setCatOverride] = useState<{ id: number; cat: CountingCategory } | null>(null)
  const chart = selected && (
    <Card title={selected.name} action={<button type="button" className="mr-link" onClick={() => setSelected(null)}>Close</button>} className="mr-tr-chart">
      <TrendGameLogChart
        key={`${selected.id}-${p.tab}`}
        playerId={selected.id}
        playerName={selected.name}
        mode={p.tab === 'minutes' ? 'minutes' : p.tab === 'usage' ? 'usage' : p.tab === 'categories' ? 'category' : 'shooting'}
        regressionMode={p.isShooting ? (p.isFormTab ? 'form' : 'season') : undefined}
        windowDays={w}
        baselineSeasons={p.baselineSeasons}
        stat={selected.stat}
        qualifiedStats={shootingStats}
        onStatChange={(stat) => setSelected({ ...selected, stat })}
        category={catOverride?.id === selected.id ? catOverride.cat : p.activeCategory}
        categories={p.leagueCats}
        onCategoryChange={(cat) => setCatOverride({ id: selected.id, cat })}
      />
    </Card>
  )

  // ---- filters -------------------------------------------------------------
  const f = p.filters
  const active: ActiveFilter[] = [
    ...p.positions.map((pos) => ({ key: `pos-${pos}`, label: pos, onRemove: () => p.setPositions(p.positions.filter((x) => x !== pos)) })),
    ...(p.fantasyTeam ? [{ key: 'team', label: fantasyTeamOptionLabel(p.fantasyTeam, p.fantasyTeam === p.myTeamName), onRemove: () => p.setFantasyTeam(null) }] : []),
    ...(f.minG15 > p.minGamesFloor ? [{ key: 'min', label: `Min ${f.minG15}+ games`, onRemove: () => p.setMinGames(p.minGamesFloor) }] : []),
    ...(p.isShooting && statFilter !== 'all' ? [{ key: 'stat', label: statFilter, onRemove: () => setStatFilter('all') }] : []),
  ]
  const resetFilters = () => {
    p.setPositions([])
    p.setFantasyTeam(null)
    p.setMinGames(p.minGamesFloor)
    setStatFilter('all')
  }
  const baselineOptions = p.isFormTab ? FORM_BASELINE_OPTIONS : BASELINE_OPTIONS

  return (
    <div className="mr-root mr-page mr-trends">
      <div>
        <h1 className="mr-h1">📈 Trends</h1>
        <p className="mr-meta">Whose situation just changed — minutes, usage, scoring categories, shooting. Tap any player for their game-by-game chart.</p>
      </div>

      <ChipRow label="Trend type">
        {TABS.map(([key, label]) => (
          <Chip key={key} selected={p.tab === key} onClick={() => pickTab(key)}>{label}</Chip>
        ))}
      </ChipRow>

      <span className="mr-meta">{TABS.find(([k]) => k === p.tab)?.[2]}</span>

      <FilterSearchRow
        search={f.nameFilter}
        onSearchChange={p.setSearch}
        placeholder="Search player…"
        activeCount={active.length}
        onOpenFilters={sheet.show}
        filtersOpen={sheet.open}
      />
      <ActiveFilterChips active={active} idle={['All positions', 'All fantasy teams']} onOpen={sheet.show} />

      <div className="mr-two mr-tr-seg2">
        <Segmented
          size="sm"
          label={p.isShootingSeasonTab ? 'Activity window' : 'Window'}
          value={p.customStartIso ? 'custom' : String(w)}
          onChange={(v) => (v === 'custom' ? p.toggleCustom() : p.selectPreset(Number(v)))}
          options={[...WINDOW_OPTIONS.map((d) => ({ value: String(d), label: `${d}d` })), { value: 'custom', label: '📆 Custom' }]}
        />
        <Segmented
          size="sm"
          label="Players"
          value={f.ownership}
          onChange={(v) => p.setOwnership(v as Ownership)}
          options={OWNERSHIP_OPTIONS.map(([value, label]) => ({ value, label }))}
        />
      </div>
      {p.isShootingSeasonTab && (
        <span className="mr-meta">Activity window — doesn't change who is flagged or the Season% / baseline numbers; it sets the G column, Min games and the highlighted stretch in the chart.</span>
      )}
      {(p.customStartIso && !p.customOpen) || p.gameNights !== null ? (
        <span className="mr-meta">
          {p.customStartIso && !p.customOpen ? `since ${formatShort(p.customStartIso)} · ${w} days` : ''}
          {p.customStartIso && !p.customOpen && p.gameNights !== null ? ' · ' : ''}
          {p.gameNights !== null ? `${p.gameNights} game nights` : ''}
        </span>
      ) : null}
      {p.customOpen && <Card>{p.customPanel}</Card>}
      {!p.isShootingSeasonTab && w < 10 && (
        <p className="mr-tr-warn">⚠ Short window ({w}d) — most rows will be based on very few games and marked <b>partial</b>.</p>
      )}

      {p.tab === 'categories' && (
        <ChipRow label="Category">
          {p.leagueCats.map((c) => (
            <Chip key={c} selected={p.activeCategory === c} onClick={() => { p.setCategory(c); setSelected(null); setCatOverride(null) }}>{c}</Chip>
          ))}
        </ChipRow>
      )}
      {p.isShooting && (
        <FilterGroup label="Baseline">
          <Segmented
            size="sm"
            label="Baseline"
            value={String(p.baselineSeasons)}
            onChange={(v) => p.setBaselineSeasons(Number(v))}
            options={baselineOptions.map(([value, label]) => ({ value: String(value), label }))}
          />
        </FilterGroup>
      )}

      {p.isLoading ? (
        <Card><p className="mr-meta" role="status">Loading trends…</p></Card>
      ) : p.errorMessage ? (
        <Card><p className="mr-tr-err" role="alert">{p.errorMessage}</p></Card>
      ) : (
        <>
          {p.eligibilityRule && <p className="mr-meta">{p.eligibilityRule}</p>}
          {chart}
          {table}
          <TabNote tab={p.tab} cat={p.activeCategory} reverse={p.reverseCats} baselineSeasons={p.baselineSeasons} />
        </>
      )}

      <FiltersSheet open={sheet.open} onClose={sheet.hide} onReset={resetFilters}>
        <PositionFilter options={ALL_POSITIONS} selected={p.positions} onChange={p.setPositions} />
        <FilterGroup label="Fantasy team">
          <ChipRow label="Fantasy team" wrap>
            <Chip selected={!p.fantasyTeam} onClick={() => p.setFantasyTeam(null)}>All fantasy teams</Chip>
            {p.teamOptions.map((t) => (
              <Chip key={t} selected={p.fantasyTeam === t} onClick={() => p.setFantasyTeam(t)}>{fantasyTeamOptionLabel(t, t === p.myTeamName)}</Chip>
            ))}
          </ChipRow>
        </FilterGroup>
        <FilterGroup label="Min games" hint={`in the last ${w} days${p.minGamesFloor > 0 ? ` (at least ${p.minGamesFloor} here)` : ''}`}>
          <ChipRow label="Min games" wrap>
            {p.minGamesOptions.map((n) => (
              <Chip key={n} selected={f.minG15 === n} onClick={() => p.setMinGames(n)}>{n === 0 ? 'Any' : `${n}+`}</Chip>
            ))}
          </ChipRow>
        </FilterGroup>
        {p.isShooting && (
          <FilterGroup label="Stat">
            <ChipRow label="Stat" wrap>
              {(['all', '3P%', 'FT%', 'FG%'] as const).map((s) => (
                <Chip key={s} selected={statFilter === s} onClick={() => setStatFilter(s)}>{s === 'all' ? 'All stats' : s}</Chip>
              ))}
            </ChipRow>
          </FilterGroup>
        )}
      </FiltersSheet>
    </div>
  )
}

function TabNote({ tab, cat, reverse, baselineSeasons }: { tab: TabKey; cat: CountingCategory; reverse: ReadonlySet<string>; baselineSeasons: number }) {
  if (tab === 'usage') {
    return (
      <p className="mr-meta">
        <b>Role ↑/↓</b> = minutes AND usage moved together (≥4 MPG and ≥2pp usage). <b>Minutes ↑/↓</b> = minutes moved, usage didn't. <b>Usage ↑/↓</b> = usage moved on flat minutes. Δ USG / Δ MPG show the raw numbers behind each label.
      </p>
    )
  }
  if (tab === 'categories') {
    return <p className="mr-meta">Δ MPG shows whether the minutes moved with it.{reverse.has(cat) && <> For {cat}, fewer is better.</>}</p>
  }
  if (tab === 'shooting-form') {
    return <p className="mr-meta">Filter: a gap of at least 1.5 standard errors — so a hot night on thin volume never lists. Ranked by z: the least likely to be luck first.{baselineSeasons === 0 ? ' Early in the season, try "Last season only".' : ''}</p>
  }
  if (tab === 'shooting-season') {
    return <p className="mr-meta">Filter: fantasy-relevant swing ≥ 0.35 makes/g-equivalent (attempts/g × |dev|), volume-weighted. Grouped by player: worst-offending stat surfaces first.</p>
  }
  return null
}

import { useMemo, useState } from 'react'
import PlayerNameLink from '../../components/PlayerNameLink'
import { useAdjustableProjection, fmtProjStat, projPctParts } from '../../hooks/useAdjustableProjection'
import { fantasyTeamOptionLabel } from '../../myTeam/display'
import type { PlayerMatchup, ProjectionStats } from '../../types/api'
import { coherentInts } from '../../utils/coherentRound'
import {
  ActiveFilterChips,
  Button,
  Card,
  Chip,
  ChipRow,
  FilterGroup,
  FilterSearchRow,
  FiltersSheet,
  MinutesStepper,
  SelectSheet,
  StatusPill,
  useSheetHistory,
  type ActiveFilter,
} from '../ui'
import './projections.css'

export interface MobileProjectionsProps {
  isLoading: boolean
  error: boolean
  slateDate: string
  setSlateDate: (d: string) => void
  upcomingDates: string[]
  pastDates: string[]
  currentSlateDate: string | null | undefined
  integerMode: boolean
  setIntegerMode: (v: boolean) => void
  search: string
  setSearch: (v: string) => void
  nbaTeam: string
  setNbaTeam: (v: string) => void
  nbaTeamOptions: string[]
  fantasyTeamId: string
  setFantasyTeamId: (v: string) => void
  /** Fantasy teams, my team first. */
  fantasyTeams: { id: string; name: string; mine: boolean }[]
  /** After the page's filters. */
  matchups: PlayerMatchup[]
  /** Players with a game on the slate before search/filters (empty-state wording). */
  totalWithGames: number
  playerIdMap: Map<string, number>
}

type SortKey = 'pts' | 'min' | 'reb' | 'ast' | 'three_pm' | 'stl' | 'blk' | 'fg_pct' | 'ft_pct'
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'pts', label: 'PTS' },
  { key: 'min', label: 'MIN' },
  { key: 'reb', label: 'REB' },
  { key: 'ast', label: 'AST' },
  { key: 'three_pm', label: '3PM' },
  { key: 'stl', label: 'STL' },
  { key: 'blk', label: 'BLK' },
  { key: 'fg_pct', label: 'FG%' },
  { key: 'ft_pct', label: 'FT%' },
]

/** Sort value from the model's line (not a stepper change, so cards don't jump while adjusting). */
function sortValue(m: PlayerMatchup, key: SortKey): number {
  const p = m.projection
  if (!p || p.status === 'red' || !p.stats) return -Infinity
  return key === 'min' ? p.default_minutes : (p.stats[key] as number)
}

/**
 * Projections on a phone: one card per player (status dot, injury tag,
 * matchup, minutes stepper, projected line), sort chips and "Reset to default
 * minutes". Projections.tsx keeps the slate, filters and data.
 */
export default function MobileProjections(p: MobileProjectionsProps) {
  const sheet = useSheetHistory('filters')
  const [sort, setSort] = useState<SortKey>('pts')
  const [resetKey, setResetKey] = useState(0)

  const rows = useMemo(
    () => [...p.matchups].sort((a, b) => sortValue(b, sort) - sortValue(a, sort)),
    [p.matchups, sort],
  )

  const slateOptions = [
    {
      value: '',
      label:
        p.slateDate === '' && p.currentSlateDate
          ? `Upcoming (live) — ${p.currentSlateDate}`
          : p.slateDate === '' && p.currentSlateDate === null
            ? 'Upcoming (live) — no games scheduled'
            : 'Upcoming (live)',
    },
    ...p.upcomingDates.map((d) => ({ value: d, label: d })),
    ...p.pastDates.map((d) => ({ value: `past:${d}`, label: `${d} · past (debug)` })),
  ]
  // Past and upcoming lists can share a date; the prefix keeps the options apart.
  const slateValue = p.slateDate === '' || p.upcomingDates.includes(p.slateDate) ? p.slateDate : `past:${p.slateDate}`

  const teamName = (id: string) => (id === '0' ? 'Free Agents / Waivers' : p.fantasyTeams.find((t) => t.id === id)?.name ?? id)
  const active: ActiveFilter[] = [
    ...(p.nbaTeam ? [{ key: 'nba', label: p.nbaTeam, onRemove: () => p.setNbaTeam('') }] : []),
    ...(p.fantasyTeamId !== '' ? [{ key: 'ft', label: teamName(p.fantasyTeamId), onRemove: () => p.setFantasyTeamId('') }] : []),
  ]

  return (
    <div className="mr-root mr-page mr-proj">
      <div>
        <h1 className="mr-h1">Projections</h1>
        <p className="mr-meta">
          {p.slateDate
            ? `Slate of ${p.slateDate} — predictions use current player state (what-if view).`
            : "Live model projections for tonight's games."}
        </p>
      </div>

      <div className="mr-frow">
        <span className="mr-meta">Slate</span>
        <SelectSheet
          id="slate"
          label="Slate"
          options={slateOptions}
          value={slateValue}
          onChange={(v) => p.setSlateDate(v.startsWith('past:') ? v.slice(5) : v)}
        />
      </div>
      <label className="mr-pj-check">
        <input type="checkbox" checked={p.integerMode} onChange={(e) => p.setIntegerMode(e.target.checked)} />
        Integer projections
      </label>

      <FilterSearchRow
        search={p.search}
        onSearchChange={p.setSearch}
        placeholder="Search player..."
        activeCount={active.length}
        onOpenFilters={sheet.show}
        filtersOpen={sheet.open}
      />
      <ActiveFilterChips active={active} idle={['All NBA Teams', 'All Fantasy Teams']} onOpen={sheet.show} />

      <div className="mr-frow">
        <span className="mr-meta mr-pj-grow" aria-live="polite">{p.matchups.length} players</span>
        <Button size="sm" onClick={() => setResetKey((k) => k + 1)}>↺ Reset to default minutes</Button>
      </div>

      <div className="mr-frow mr-pj-sort">
        <span className="mr-meta">Sort</span>
        <ChipRow label="Sort by">
          {SORTS.map((s) => (
            <Chip key={s.key} selected={sort === s.key} onClick={() => setSort(s.key)}>{s.label}</Chip>
          ))}
        </ChipRow>
      </div>

      {p.isLoading ? (
        <Card><p className="mr-meta" role="status">Loading projections...</p></Card>
      ) : p.error ? (
        <Card><p className="mr-pj-error" role="alert">Failed to load projections.</p></Card>
      ) : rows.length === 0 ? (
        <Card>
          <p className="mr-meta">
            {p.totalWithGames === 0
              ? p.slateDate ? `No games on ${p.slateDate}.` : 'No games today.'
              : 'No players match the filters.'}
          </p>
        </Card>
      ) : (
        <div className="mr-pj-list">
          {rows.map((m) => (
            <ProjectionCard
              key={m.player_name}
              matchup={m}
              integerMode={p.integerMode}
              resetKey={resetKey}
              playerId={p.playerIdMap.get(m.player_name)}
            />
          ))}
        </div>
      )}

      <FiltersSheet
        open={sheet.open}
        onClose={sheet.hide}
        onReset={() => {
          p.setNbaTeam('')
          p.setFantasyTeamId('')
        }}
      >
        <FilterGroup label="NBA team">
          <ChipRow label="NBA team" wrap>
            <Chip selected={p.nbaTeam === ''} onClick={() => p.setNbaTeam('')}>All NBA Teams</Chip>
            {p.nbaTeamOptions.map((t) => (
              <Chip key={t} selected={p.nbaTeam === t} onClick={() => p.setNbaTeam(t)}>{t}</Chip>
            ))}
          </ChipRow>
        </FilterGroup>
        <FilterGroup label="Fantasy team">
          <ChipRow label="Fantasy team" wrap>
            <Chip selected={p.fantasyTeamId === ''} onClick={() => p.setFantasyTeamId('')}>All Fantasy Teams</Chip>
            <Chip selected={p.fantasyTeamId === '0'} onClick={() => p.setFantasyTeamId('0')}>Free Agents / Waivers</Chip>
            {p.fantasyTeams.map((t) => (
              <Chip key={t.id} selected={p.fantasyTeamId === t.id} onClick={() => p.setFantasyTeamId(t.id)}>
                {fantasyTeamOptionLabel(t.name, t.mine)}
              </Chip>
            ))}
          </ChipRow>
        </FilterGroup>
      </FiltersSheet>
    </div>
  )
}

const LINE: { key: keyof ProjectionStats; label: string }[] = [
  { key: 'pts', label: 'PTS' },
  { key: 'reb', label: 'REB' },
  { key: 'ast', label: 'AST' },
  { key: 'three_pm', label: '3PM' },
  { key: 'stl', label: 'STL' },
  { key: 'blk', label: 'BLK' },
]

function ProjectionCard({ matchup, integerMode, resetKey, playerId }: {
  matchup: PlayerMatchup
  integerMode: boolean
  resetKey: number
  playerId: number | undefined
}) {
  const { proj, minutes, stats, setMinutes, resetToDefault, defaultMinutes } = useAdjustableProjection(matchup, resetKey)
  const noData = !proj || proj.status === 'red' || !stats
  const status = noData ? 'red' : proj.status
  const mu = `${matchup.pro_team} ${matchup.is_home ? 'vs' : '@'} ${matchup.opponent}`
  const def = Math.round(defaultMinutes)

  const head = (
    <div className="mr-pj-head">
      <span className={`mr-pj-dot mr-pj-${status}`} role="img" aria-label={`Projection status: ${status}`} title={proj?.reason || undefined} />
      <PlayerNameLink name={matchup.player_name} playerId={playerId} className="mr-pj-name" />
      {matchup.injury_status && <StatusPill status={matchup.injury_status}>{matchup.injury_status}</StatusPill>}
      <span className="mr-meta mr-pj-mu">{mu}</span>
    </div>
  )

  if (noData) {
    return (
      <section className="mr-card mr-pj-card">
        {head}
        <p className="mr-pj-nodata">not enough data{proj?.reason ? ` · ${proj.reason}` : ''}</p>
      </section>
    )
  }

  const coherent = integerMode ? coherentInts(stats) : null
  const fg = projPctParts(stats.fg_pct, coherent ? coherent.fgm : stats.fgm, coherent ? coherent.fga : stats.fga, integerMode)
  const ft = projPctParts(stats.ft_pct, coherent ? coherent.ftm : stats.ftm, coherent ? coherent.fta : stats.fta, integerMode)
  const val = (key: keyof ProjectionStats) =>
    coherent && (key === 'pts' || key === 'three_pm') ? String(coherent[key]) : fmtProjStat(stats[key] as number, integerMode)

  return (
    <section className="mr-card mr-pj-card">
      {head}
      <div className="mr-frow">
        <MinutesStepper
          value={Math.round(minutes)}
          defaultValue={def}
          playerName={matchup.player_name}
          onChange={(v) => (v === def ? resetToDefault() : setMinutes(v))}
        />
        {proj.status !== 'green' && proj.reason && <span className="mr-meta mr-pj-note">{proj.reason}</span>}
      </div>
      <dl className="mr-pj-line">
        {LINE.map((s) => (
          <div key={s.key}>
            <dt>{s.label}</dt>
            <dd>{val(s.key)}</dd>
          </div>
        ))}
        <div>
          <dt>FG%</dt>
          <dd>
            {fg.pct}
            {fg.ok && <small>{fg.m}/{fg.a}</small>}
          </dd>
        </div>
        <div>
          <dt>FT%</dt>
          <dd>
            {ft.pct}
            {ft.ok && <small>{ft.m}/{ft.a}</small>}
          </dd>
        </div>
      </dl>
    </section>
  )
}

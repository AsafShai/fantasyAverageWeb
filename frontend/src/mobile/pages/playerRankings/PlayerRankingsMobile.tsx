import { useRef, useState, type ReactNode } from 'react'
import { CoverageNotice } from '../../../components/DateRangePicker'
import PlayerNameLink from '../../../components/PlayerNameLink'
import { METRIC_GLOSSARY } from '../../../constants/metricGlossary'
import { formatShort } from '../../../utils/dateRange'
import { useWeightDraft } from '../../../hooks/useWeightDraft'
import { CATEGORY_LABELS, type RankedPlayer, type RankingCategory } from '../../../utils/playerRankings'
import type { CustomDateRange, Team, TimePeriod } from '../../../types/api'
import { ActiveFilterChips, Button, DataTable, FilterSearchRow, PeriodChips, Segmented, useSheetHistory, type Column } from '../../ui'
import { PlayerRankingsFilters } from './PlayerRankingsFilters'
import { activeFilterChips, type RankingsFilters } from './filters'
import './playerRankings.css'

type Mode = 'totals' | 'per_game'
type Weights = Record<RankingCategory, number>

export interface RankedRow {
  ranked: RankedPlayer
  rank: number
}

/**
 * Everything the phone view needs from the page. PlayerRankings keeps all the
 * state and the ranking maths; this component only lays it out.
 */
export interface PlayerRankingsMobileProps {
  search: string
  onSearchChange: (value: string) => void
  searchActive: boolean
  hasCalculated: boolean
  rows: RankedRow[]
  sortCol: string
  sortAsc: boolean
  onSort: (col: string, asc: boolean) => void
  calcMode: Mode
  onCalcMode: (m: Mode) => void
  displayMode: Mode
  onDisplayMode: (m: Mode) => void
  period: TimePeriod
  onPeriod: (p: TimePeriod) => void
  customRange: CustomDateRange | null
  onCustomRange: (r: CustomDateRange | null) => void
  actualStart?: string | null
  actualEnd?: string | null
  filters: RankingsFilters
  teams: Team[]
  myTeamId: number | null
  isMyTeam: (teamId: number) => boolean
  categories: RankingCategory[]
  weights: Weights
  onWeights: (w: Weights) => void
  sliderResetKey: number
  playersLoaded: number
  onReset: () => void
  isPunted: (cat: RankingCategory) => boolean
  fantasyAbbrev: (teamId: number) => string
  minutesText: (r: RankedPlayer) => string
  rawText: (r: RankedPlayer, cat: RankingCategory) => string
}

const MODES = [
  { value: 'totals', label: 'Totals' },
  { value: 'per_game', label: 'Per Game' },
] as const

const label = (cat: RankingCategory) => CATEGORY_LABELS[cat] ?? cat

export default function PlayerRankingsMobile(p: PlayerRankingsMobileProps) {
  const filtersSheet = useSheetHistory('filters')
  const chips = activeFilterChips(p.filters, p.teams)
  const [explain, setExplain] = useState(false)
  const resultsRef = useRef<HTMLDivElement>(null)
  const empty = p.hasCalculated && p.rows.length === 0

  const columns: Column<RankedRow>[] = [
    {
      key: 'player',
      header: 'PLAYER',
      pinned: true,
      cell: ({ ranked }) => (
        <PlayerNameLink name={ranked.player.player_name} playerId={ranked.player.player_id} className="mr-pr-name" />
      ),
    },
    { key: 'rank', header: '#', sortable: true, firstDir: 'asc', cell: (r) => <span className="mr-meta">{r.rank}</span> },
    { key: 'totalZ', header: 'Z', headerLabel: 'Total Z-score', sortable: true, className: 'mr-pr-z', cell: ({ ranked }) => ranked.totalZ.toFixed(2) },
    { key: 'min', header: p.displayMode === 'totals' ? 'MIN' : 'MPG', sortable: true, cell: ({ ranked }) => p.minutesText(ranked) },
    ...p.categories.map<Column<RankedRow>>((cat) => ({
      key: `${cat}_raw`,
      header: <Punted on={p.isPunted(cat)}>{label(cat)}</Punted>,
      headerLabel: label(cat),
      sortable: true,
      cell: ({ ranked }) => p.rawText(ranked, cat),
    })),
    { key: 'gp', header: 'GP', sortable: true, cell: ({ ranked }) => ranked.player.stats.gp },
    ...p.categories.map<Column<RankedRow>>((cat) => ({
      key: cat,
      header: <Punted on={p.isPunted(cat)}>{`${label(cat)}_z`}</Punted>,
      headerLabel: `${label(cat)} z-score`,
      sortable: true,
      cell: ({ ranked }) => {
        const z = ranked.zScores[cat]
        const cls = p.isPunted(cat) ? 'mr-pr-punted' : z >= 0 ? 'mr-pr-up' : 'mr-pr-down'
        return <span className={cls}>{z.toFixed(2)}</span>
      },
    })),
    {
      key: 'fantasy',
      header: 'FANTASY',
      align: 'left',
      cell: ({ ranked }) => {
        const fa = ranked.player.team_id === 0
        return (
          <span className={fa ? 'mr-meta' : undefined} title={fa ? 'Free agent' : (ranked.player.fantasy_team_name ?? undefined)}>
            {p.fantasyAbbrev(ranked.player.team_id)}
          </span>
        )
      },
    },
    { key: 'team', header: 'TEAM', align: 'left', cell: ({ ranked }) => <span className="mr-meta">{ranked.player.pro_team}</span> },
    { key: 'pos', header: 'POS', align: 'left', cell: ({ ranked }) => <span className="mr-meta">{ranked.player.positions.join(', ')}</span> },
  ]

  return (
    <div className="mr-page mr-pr">
      <h1 className="mr-h1">Player Rankings</h1>

      <FilterSearchRow
        search={p.search}
        onSearchChange={p.onSearchChange}
        activeCount={chips.length}
        onOpenFilters={filtersSheet.show}
        filtersOpen={filtersSheet.open}
      />

      {p.searchActive && p.hasCalculated && (
        <p className="mr-meta mr-pr-tight" aria-live="polite">
          {p.rows.length === 0
            ? 'No players match'
            : `${p.rows.length} ${p.rows.length === 1 ? 'player' : 'players'} found · ranks are overall`}
          {p.rows.length > 0 && (
            <>
              {' · '}
              <button type="button" className="mr-link mr-pr-inline" onClick={() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                View results ↓
              </button>
            </>
          )}
        </p>
      )}

      <ActiveFilterChips
        active={chips.map((c) => ({ key: c.key, label: c.label, onRemove: c.clear }))}
        onOpen={filtersSheet.show}
      />

      <div className="mr-two">
        <div className="mr-pr-lab">
          <span className="mr-meta">Calc mode</span>
          <Segmented size="sm" label="Calc mode" className="mr-pr-calc" options={MODES} value={p.calcMode} onChange={p.onCalcMode} />
        </div>
        <div className="mr-pr-lab">
          <span className="mr-meta">Display mode</span>
          <Segmented size="sm" label="Display mode" className="mr-pr-disp" options={MODES} value={p.displayMode} onChange={p.onDisplayMode} />
        </div>
      </div>

      <PeriodChips value={p.period} onChange={p.onPeriod} customRange={p.customRange} onCustomRangeChange={p.onCustomRange} showLastNight />

      {p.actualStart && p.actualEnd && (
        <span className="mr-meta">
          Showing {p.actualStart === p.actualEnd ? formatShort(p.actualStart) : `${formatShort(p.actualStart)} – ${formatShort(p.actualEnd)}`}
        </span>
      )}

      <details className="mr-card mr-pr-weights" open>
        <summary className="mr-h2">Category weights</summary>
        <WeightRows key={p.sliderResetKey} categories={p.categories} initialWeights={p.weights} onCommit={p.onWeights} />
        <div className="mr-pr-foot">
          <span className="mr-meta">
            {p.playersLoaded} players loaded · <span className="mr-pr-blue">Blue</span> = calc mode ·{' '}
            <span className="mr-pr-purple">Purple</span> = display mode · everything updates live
          </span>
          <Button size="sm" onClick={p.onReset}>Reset</Button>
        </div>
      </details>

      {p.period === 'custom' && p.customRange && (
        <CoverageNotice
          requestedStart={p.customRange.start}
          requestedEnd={p.customRange.end}
          actualStart={p.actualStart ?? undefined}
          actualEnd={p.actualEnd ?? undefined}
        />
      )}

      {!p.hasCalculated && <p className="mr-pr-empty">Set your weights and press Calculate to rank players.</p>}

      {empty && (
        <p className="mr-pr-empty">
          {p.searchActive ? (
            <>
              No players match “{p.search.trim()}” with the current filters.{' '}
              <button type="button" className="mr-link mr-pr-inline" onClick={() => p.onSearchChange('')}>Clear search</button>
            </>
          ) : 'No players match the current filters.'}
        </p>
      )}

      {p.hasCalculated && p.rows.length > 0 && (
        <div ref={resultsRef} className="mr-pr-results">
          <DataTable
            caption="Player rankings"
            className="mr-pr-table"
            columns={columns}
            rows={p.rows}
            rowKey={({ ranked }) => `${ranked.player.player_name}-${ranked.player.team_id}`}
            sort={{ key: p.sortCol, dir: p.sortAsc ? 'asc' : 'desc' }}
            onSortChange={(s) => p.onSort(s.key, s.dir === 'asc')}
            isHighlighted={({ ranked }) => ranked.player.team_id !== 0 && p.isMyTeam(ranked.player.team_id)}
          />
        </div>
      )}

      <button type="button" className="mr-link" aria-expanded={explain} onClick={() => setExplain((e) => !e)}>
        ⓘ Explain: {METRIC_GLOSSARY.totalZ.title}
      </button>
      {explain && (
        <div className="mr-card mr-pr-explain">
          <span className="mr-h2">{METRIC_GLOSSARY.totalZ.title}</span>
          <span>{METRIC_GLOSSARY.totalZ.body}</span>
          {METRIC_GLOSSARY.totalZ.formula && <code>{METRIC_GLOSSARY.totalZ.formula}</code>}
        </div>
      )}

      <PlayerRankingsFilters
        open={filtersSheet.open}
        onClose={filtersSheet.hide}
        filters={p.filters}
        teams={p.teams}
        myTeamId={p.myTeamId}
        isMyTeam={p.isMyTeam}
      />
    </div>
  )
}

function Punted({ on, children }: { on: boolean; children: ReactNode }) {
  return <span className={on ? 'mr-pr-punted' : undefined}>{children}</span>
}

function WeightRows({ categories, initialWeights, onCommit }: {
  categories: RankingCategory[]
  initialWeights: Weights
  onCommit: (w: Weights) => void
}) {
  const { weights, isPunted, slide, togglePunt } = useWeightDraft(initialWeights, onCommit)
  return (
    <div className="mr-pr-wlist">
      {categories.map((cat) => {
        const punted = isPunted(cat)
        return (
          <div key={cat} className={`mr-pr-wrow ${punted ? 'mr-pr-wpunt' : ''}`.trim()}>
            <b>{label(cat)}</b>
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              aria-label={`${label(cat)} weight`}
              value={punted ? 0 : weights[cat]}
              disabled={punted}
              onChange={(e) => slide(cat, Number(e.target.value))}
            />
            <span className="mr-pr-wv">{punted ? '—' : weights[cat].toFixed(1)}</span>
            <button type="button" className="mr-pr-punt" aria-pressed={punted} onClick={() => togglePunt(cat)}>
              {punted ? 'PUNT' : 'punt'}
            </button>
          </div>
        )
      })}
    </div>
  )
}

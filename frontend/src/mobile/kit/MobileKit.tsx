import { useEffect, useMemo, useState } from 'react'
import {
  BottomSheet,
  Button,
  Card,
  Chip,
  ChipRow,
  ChipSelect,
  DataTable,
  Delta,
  FaMark,
  MinutesStepper,
  MoveKindPill,
  Segmented,
  SelectSheet,
  SlotPill,
  StatusPill,
  useSheetHistory,
  type Column,
  type SortState,
} from '../ui'
import { ensureMobileFonts } from '../fonts'
import { CATS, MY_TEAM_ID, TEAMS, type TeamRow } from './sampleData'

/**
 * Dev-only showcase of the redesign's shared components (/mobile-kit.html).
 * Used for review screenshots at 390px; never shipped in the build.
 */
export default function MobileKit() {
  useEffect(() => ensureMobileFonts(), [])

  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  const [layout, setLayout] = useState<'table' | 'cards'>('table')
  const [show, setShow] = useState<'standings' | 'rankings'>('rankings')
  const [values, setValues] = useState<'averages' | 'totals'>('averages')
  const [period, setPeriod] = useState('season')
  const [team, setTeam] = useState('all')
  const [sort, setSort] = useState<SortState | null>({ key: 'points', dir: 'desc' })
  const [minutes, setMinutes] = useState(31)
  const [statuses, setStatuses] = useState<string[]>(['Out'])
  const filters = useSheetHistory('filters')

  const rows = useMemo(() => {
    if (!sort) return TEAMS
    const val = (t: TeamRow) =>
      sort.key === 'points' ? t.points : sort.key === 'gp' ? t.gp : sort.key === 'team' ? t.rank : t.avg[CATS.indexOf(sort.key as (typeof CATS)[number])]
    const out = [...TEAMS].sort((a, b) => val(a) - val(b))
    return sort.dir === 'asc' ? out : out.reverse()
  }, [sort])

  const rankings = show === 'rankings'
  const columns: Column<TeamRow>[] = [
    {
      key: 'team',
      header: '# Team',
      pinned: true,
      sortable: true,
      firstDir: 'asc',
      cell: (t) => (
        <>
          <span className="mr-meta" style={{ marginRight: 6 }}>{t.rank}</span>
          {t.name}
          {rankings && <Delta value={t.rankDelta} />}
        </>
      ),
    },
    ...CATS.map<Column<TeamRow>>((c, i) => ({
      key: c,
      header: c,
      sortable: true,
      cell: (t) => (i < 2 ? t.avg[i].toFixed(3).replace(/^0/, '') : t.avg[i].toFixed(2)),
    })),
    {
      key: 'points',
      header: 'TOTAL',
      sortable: true,
      className: 'mr-num',
      cell: (t) => (
        <b>
          {t.points}
          {rankings && <Delta value={t.pointsDelta} kind="total" />}
        </b>
      ),
    },
    {
      key: 'gp',
      header: 'GP',
      sortable: true,
      cell: (t) => (
        <>
          {t.gp}
          {rankings && <Delta value={t.gpDelta} kind="gp" />}
        </>
      ),
    },
  ]

  const teamOptions = [{ value: 'all', label: 'All teams' }, ...TEAMS.map((t) => ({ value: String(t.id), label: t.name }))]
  const toggleStatus = (s: string) => setStatuses((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]))

  return (
    <div className="mr-root" style={{ minHeight: '100vh', padding: '12px 12px 40px', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 480, margin: '0 auto' }}>
        <div className="mr-card-head">
          <h1 className="mr-h1">Component kit</h1>
          <button type="button" className="mr-select" onClick={() => setDark((d) => !d)} aria-pressed={dark}>
            {dark ? '☀️ Light' : '🌙 Dark'}
          </button>
        </div>
        <p className="mr-meta" style={{ margin: 0 }}>Mobile redesign · step 1 foundation. Real data from Nov 6.</p>

        <Card title="Segmented">
          <Segmented label="Layout" options={[{ value: 'table', label: 'Table' }, { value: 'cards', label: 'Cards' }]} value={layout} onChange={setLayout} />
          <Segmented label="Show" options={[{ value: 'standings', label: 'Standings' }, { value: 'rankings', label: 'Rankings' }]} value={show} onChange={setShow} />
          <Segmented size="sm" label="Values" options={[{ value: 'averages', label: 'Averages' }, { value: 'totals', label: 'Totals' }]} value={values} onChange={setValues} />
        </Card>

        <Card title="Chips & select">
          <ChipSelect
            label="Period"
            value={period}
            onChange={setPeriod}
            options={[
              { value: 'night', label: 'Last night' },
              { value: 'season', label: 'Season' },
              { value: '30', label: 'Last 30' },
              { value: '15', label: 'Last 15' },
              { value: '7', label: 'Last 7' },
              { value: 'proj', label: 'Projections' },
            ]}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <SelectSheet id="team" label="Fantasy team" options={teamOptions} value={team} onChange={setTeam} />
            <Chip onClick={filters.show}>
              Filters <span className="mr-count">{statuses.length}</span>
            </Chip>
          </div>
          <ChipRow label="Active filters">
            {statuses.map((s) => (
              <Chip key={s} selected removable onClick={() => toggleStatus(s)} aria-label={`Remove filter ${s}`}>
                {s}
              </Chip>
            ))}
          </ChipRow>
        </Card>

        <Card title="Pills">
          <div className="mr-meta">Status</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <StatusPill status="Out" />
            <StatusPill status="Doubtful" />
            <StatusPill status="Questionable" />
            <StatusPill status="Probable" />
            <StatusPill status="Available" />
          </div>
          <div className="mr-meta">Slot</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <SlotPill slot="PG" />
            <SlotPill slot="G" />
            <SlotPill slot="UTIL" />
            <SlotPill slot="BE" />
            <SlotPill slot="IR" />
          </div>
          <div className="mr-meta">Move kind · FA mark</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <MoveKindPill kind="added" />
            <MoveKindPill kind="waiver" />
            <MoveKindPill kind="trade" />
            <MoveKindPill kind="dropped" />
            <span style={{ fontSize: 13 }}>
              <FaMark />
              Collin Gillespie
            </span>
          </div>
          <div className="mr-meta">Deltas (Rankings view only)</div>
          <div style={{ display: 'flex', gap: 14, fontSize: 14, alignItems: 'baseline' }}>
            <span>3<Delta value={1} /></span>
            <span>9<Delta value={-6} /></span>
            <span>51<Delta value={0} kind="total" /></span>
            <span>81<Delta value={2} kind="gp" /></span>
          </div>
        </Card>

        <Card title={rankings ? 'Table · Rankings view' : 'Table · Standings view'} action={<span className="mr-meta">tap a header to sort</span>}>
          <DataTable
            caption="Standings"
            columns={columns}
            rows={rows}
            rowKey={(t) => String(t.id)}
            sort={sort}
            onSortChange={setSort}
            isHighlighted={(t) => t.id === MY_TEAM_ID}
          />
        </Card>

        <Card title="Minutes stepper">
          <div style={{ background: 'var(--mr-sunken)', borderRadius: 12, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="mr-meta" style={{ flex: 1 }}>
                <b style={{ color: 'var(--mr-text)' }}>Next: vs POR · Fri</b>
              </span>
              <MinutesStepper value={minutes} defaultValue={31} onChange={setMinutes} playerName="Donovan Mitchell" />
            </div>
            <span className="mr-meta">Each change calls the projection model (POST /projections/predict) on the real pages.</span>
          </div>
        </Card>

        <Card title="Empty table">
          <DataTable caption="Empty" columns={columns.slice(0, 3)} rows={[]} rowKey={(t) => String(t.id)} empty="No teams match these filters" />
        </Card>
      </div>

      <BottomSheet
        open={filters.open}
        onClose={filters.hide}
        title="Filters"
        action={<button type="button" className="mr-link" onClick={() => setStatuses([])}>Reset</button>}
      >
        <div className="mr-meta" style={{ fontWeight: 700 }}>Status</div>
        <ChipRow label="Status" wrap>
          {['Out', 'Doubtful', 'Questionable', 'Probable', 'Available'].map((s) => (
            <Chip key={s} selected={statuses.includes(s)} onClick={() => toggleStatus(s)}>
              {s}
            </Chip>
          ))}
        </ChipRow>
        <Button variant="primary" onClick={filters.hide}>
          Show results
        </Button>
      </BottomSheet>
    </div>
  )
}

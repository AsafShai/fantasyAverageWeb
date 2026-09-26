import { useState } from 'react'
import { Link } from 'react-router'
import { useGetAdpMoversQuery } from '../../store/api/fantasyApi'
import { usePersistedState } from '../../hooks/usePersistedState'
import { getErrorMessage } from '../../utils/errorMessage'
import LoadingSpinner from '../../components/LoadingSpinner'
import ErrorMessage from '../../components/ErrorMessage'
import PlayerIdentityCell from '../../components/draft/PlayerIdentityCell'
import { SITE_LABEL, formatAdp, sitesForMetric, type AdpSiteKey } from '../../utils/adp'
import {
  MOVERS_TOP_OPTIONS,
  MOVERS_WINDOWS,
  type MoversDirection,
  type MoversWindow,
  effectiveWindow,
  formatMoveDelta,
  formatMoverDate,
  moversQueryArgs,
  shortDateRange,
} from '../../utils/adpMovers'
import type { AdpMetric, AdpMover, AdpMoversSection, AdpSnapshotHistory } from '../../types/api'

const SITE_STORAGE: Record<AdpMetric, string> = {
  adp: 'draft.movers.adpSites',
  rank: 'draft.movers.rankSites',
}

function MoverRow({ mover, index, kind }: { mover: AdpMover; index: number; kind: 'up' | 'down' }) {
  const color =
    kind === 'up' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
  return (
    <li className="flex items-center gap-2 py-2 border-b border-gray-100 dark:border-gray-800 last:border-b-0">
      <span className="w-4 shrink-0 text-right text-xs tabular-nums text-gray-400">{index + 1}</span>
      <span className={`w-14 shrink-0 text-right text-lg font-bold tabular-nums ${color}`}>
        {formatMoveDelta(mover.delta)}
      </span>
      <div className="min-w-0 flex-1">
        <PlayerIdentityCell
          name={mover.name}
          playerId={mover.espn_id}
          photoUrl={mover.photo_url}
          teamAbbr={mover.team_abbr}
          positions={mover.positions}
        />
        <div className="pl-10 text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
          {formatAdp(mover.from_value)} → {formatAdp(mover.to_value)}
        </div>
      </div>
    </li>
  )
}

function MoverList({
  title,
  movers,
  kind,
  empty,
}: {
  title: string
  movers: AdpMover[]
  kind: 'up' | 'down'
  empty: string
}) {
  const accent =
    kind === 'up'
      ? 'border-emerald-500 text-emerald-700 dark:text-emerald-300'
      : 'border-rose-500 text-rose-700 dark:text-rose-300'
  return (
    <div className="min-w-0">
      <h3 className={`text-xs font-bold uppercase tracking-wide pb-1 mb-1 border-b-2 ${accent}`}>{title}</h3>
      {movers.length ? (
        <ol>
          {movers.map((m, i) => (
            <MoverRow key={m.id} mover={m} index={i} kind={kind} />
          ))}
        </ol>
      ) : (
        <p className="text-sm text-gray-400 py-3">{empty}</p>
      )}
    </div>
  )
}

function InOutList({ title, movers, field }: { title: string; movers: AdpMover[]; field: 'to_value' | 'from_value' }) {
  if (!movers.length) return null
  return (
    <div className="min-w-0">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">{title}</h4>
      <ul className="flex flex-wrap gap-1.5">
        {movers.map((m) => (
          <li
            key={m.id}
            className="text-xs rounded-full px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200"
          >
            {m.name} <span className="tabular-nums text-gray-500">{formatAdp(m[field])}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function SectionCard({
  section,
  direction,
  metric,
  top,
}: {
  section: AdpMoversSection
  direction: MoversDirection
  metric: AdpMetric
  top: number
}) {
  const unit = metric === 'adp' ? 'ADP' : 'rank'
  const range = shortDateRange(section.from_date, section.to_date)
  const hasMoves = section.risers.length || section.fallers.length
  const nothing = !hasMoves && !section.entered.length && !section.exited.length
  const depth = top ? `top ${top}` : 'the list'
  return (
    <section className="card p-3 sm:p-4 min-w-0">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <h2 className="text-base font-bold text-gray-800 dark:text-gray-100">
          {section.label} {unit === 'ADP' ? 'ADP' : 'Rankings'}
        </h2>
        {range ? <span className="text-xs text-gray-500 tabular-nums whitespace-nowrap">{range}</span> : null}
      </div>
      {section.note ? <p className="text-xs text-amber-700 dark:text-amber-300 mb-2">{section.note}</p> : null}
      {nothing && !section.note ? (
        <p className="text-sm text-gray-400 py-2">No movement in {depth} for this period.</p>
      ) : null}
      {!nothing ? (
        <div className={`grid gap-4 ${direction === 'both' ? 'sm:grid-cols-2' : ''}`}>
          {direction !== 'fallers' ? (
            <MoverList title="Biggest risers" movers={section.risers} kind="up" empty="No risers." />
          ) : null}
          {direction !== 'risers' ? (
            <MoverList title="Biggest fallers" movers={section.fallers} kind="down" empty="No fallers." />
          ) : null}
        </div>
      ) : null}
      {section.entered.length || section.exited.length ? (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 space-y-2">
          <InOutList title={`New in ${depth}`} movers={section.entered} field="to_value" />
          <InOutList title={`Dropped out of ${depth}`} movers={section.exited} field="from_value" />
        </div>
      ) : null}
      {section.compared ? (
        <p className="mt-2 text-[11px] text-gray-400">{section.compared} players compared.</p>
      ) : null}
    </section>
  )
}

function HistoryNote({ history, metric }: { history: AdpSnapshotHistory[]; metric: AdpMetric }) {
  if (!history.length) return null
  return (
    <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
      {history.map((h) => (
        <p key={h.key}>
          <span className="font-semibold">{h.label}:</span>{' '}
          {h.first_date ? (
            <>
              history since {formatMoverDate(h.first_date)}
              {metric === 'rank' ? (
                <>
                  {' · '}
                  {h.change_dates.length
                    ? `rankings updated ${h.change_dates.slice(-4).map(formatMoverDate).join(', ')}`
                    : 'no rankings update recorded yet'}
                </>
              ) : null}
            </>
          ) : (
            'no history yet'
          )}
        </p>
      ))}
    </div>
  )
}

function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { key: T; label: string }[]
  value: T
  onChange: (next: T) => void
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 shrink-0">{label}</span>
      <div className="inline-flex flex-wrap rounded-md border border-gray-300 dark:border-gray-600 overflow-hidden">
        {options.map((opt) => (
          <button
            key={String(opt.key)}
            type="button"
            onClick={() => onChange(opt.key)}
            className={`min-h-9 px-2.5 py-1 text-xs font-semibold ${
              value === opt.key
                ? 'bg-blue-600 text-white'
                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function MoversPage() {
  const [metric, setMetric] = usePersistedState<AdpMetric>('draft.movers.metric', 'adp')
  const [adpSitesRaw, setAdpSites] = usePersistedState<AdpSiteKey[]>(SITE_STORAGE.adp, sitesForMetric('adp'))
  const [rankSitesRaw, setRankSites] = usePersistedState<AdpSiteKey[]>(SITE_STORAGE.rank, sitesForMetric('rank'))
  const [adpWindow, setAdpWindow] = usePersistedState<MoversWindow>('draft.movers.adpWindow', '3d')
  const [rankWindow, setRankWindow] = usePersistedState<MoversWindow>('draft.movers.rankWindow', 'last_update')
  const [direction, setDirection] = usePersistedState<MoversDirection>('draft.movers.direction', 'both')
  const [top, setTop] = usePersistedState<number>('draft.movers.top', 150)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const available = sitesForMetric(metric)
  const stored = metric === 'adp' ? adpSitesRaw : rankSitesRaw
  const sites = available.filter((s) => stored.includes(s))
  const activeSites = sites.length ? sites : available
  const setSites = metric === 'adp' ? setAdpSites : setRankSites
  const period = effectiveWindow(metric, metric === 'adp' ? adpWindow : rankWindow)
  const setPeriod = metric === 'adp' ? setAdpWindow : setRankWindow

  const toggleSite = (site: AdpSiteKey) =>
    setSites((prev) => (prev.includes(site) ? prev.filter((s) => s !== site) : [...prev, site]))

  // RTK Query keys requests by serialized args, so a fresh object each render is fine.
  const args = moversQueryArgs({ metric, sites: activeSites, window: period, top, customFrom, customTo })
  const { data, isLoading, isFetching, error } = useGetAdpMoversQuery(args ?? { metric, mode: 'range', top }, {
    skip: args === null,
  })

  const windows = MOVERS_WINDOWS.filter((w) => w.key !== 'last_update' || metric === 'rank')

  return (
    <div className="max-w-screen-2xl mx-auto px-4 sm:px-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">
            {metric === 'adp' ? 'ADP Movers' : 'Rankings Movers'}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-3xl">
            {metric === 'adp'
              ? 'Who is climbing and sliding in drafts. Each site’s ADP is saved once a day, and a move is the change between the two dates. Blend only counts sites that list the player on both dates.'
              : 'How each site’s own rankings changed. Sites republish rankings every week or two, so “Latest update” compares each site’s newest list with the one before it.'}
          </p>
        </div>
        <Link to="/draft/rankings-adp" className="text-sm text-blue-700 dark:text-blue-300 hover:underline whitespace-nowrap">
          Open Rankings &amp; ADP
        </Link>
      </div>

      <div className="card p-3 sm:p-4 mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <Segmented
            label="View"
            options={[
              { key: 'adp' as AdpMetric, label: 'ADP' },
              { key: 'rank' as AdpMetric, label: 'Rankings' },
            ]}
            value={metric}
            onChange={setMetric}
          />
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Sites</span>
            {available.map((site) => (
              <label key={site} className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={activeSites.includes(site)}
                  onChange={() => toggleSite(site)}
                  className="rounded border-gray-300"
                />
                {SITE_LABEL[site]}
              </label>
            ))}
          </div>
          <Segmented
            label="Show"
            options={[
              { key: 'both' as MoversDirection, label: 'Both' },
              { key: 'risers' as MoversDirection, label: 'Risers' },
              { key: 'fallers' as MoversDirection, label: 'Fallers' },
            ]}
            value={direction}
            onChange={setDirection}
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <Segmented label="Period" options={windows} value={period} onChange={setPeriod} />
          {period === 'custom' ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <input
                type="date"
                value={customFrom}
                max={customTo || undefined}
                onChange={(e) => setCustomFrom(e.target.value)}
                aria-label="From date"
                className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1"
              />
              <span className="text-gray-400">→</span>
              <input
                type="date"
                value={customTo}
                min={customFrom || undefined}
                onChange={(e) => setCustomTo(e.target.value)}
                aria-label="To date"
                className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1"
              />
            </div>
          ) : null}
          <Segmented
            label="Depth"
            options={MOVERS_TOP_OPTIONS.map((n) => ({ key: n, label: n ? `Top ${n}` : 'All' }))}
            value={top}
            onChange={setTop}
          />
        </div>
      </div>

      {args === null ? (
        <p className="text-sm text-gray-500 py-6 text-center">Pick a start date to compare.</p>
      ) : isLoading && !data ? (
        <LoadingSpinner />
      ) : error && !data ? (
        <ErrorMessage message={getErrorMessage(error, 'Failed to load movers')} />
      ) : data ? (
        <div className={isFetching ? 'opacity-70' : undefined}>
          <div className="grid gap-4 lg:grid-cols-2">
            {data.sections.map((section) => (
              <SectionCard key={section.key} section={section} direction={direction} metric={metric} top={top} />
            ))}
          </div>
          <div className="mt-4">
            <HistoryNote history={data.history} metric={metric} />
          </div>
        </div>
      ) : null}
    </div>
  )
}

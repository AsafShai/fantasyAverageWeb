import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useGetAdpQuery, useLazyGetAdpQuery } from '../../store/api/fantasyApi'
import { usePersistedState } from '../../hooks/usePersistedState'
import { useDebounce } from '../../hooks/useDebounce'
import { getErrorMessage } from '../../utils/errorMessage'
import LoadingSpinner from '../../components/LoadingSpinner'
import ErrorMessage from '../../components/ErrorMessage'
import PlayerIdentityCell from '../../components/draft/PlayerIdentityCell'
import {
  ADP_SITES,
  SITE_LABEL,
  adpDeltaClass,
  formatAdp,
  formatUpdatedAt,
  type AdpSiteKey,
} from '../../utils/adp'
import { downloadCsv, toCsv } from '../../utils/draftCsv'

type SortKey = 'blend' | 'spread' | 'name' | 'team' | AdpSiteKey

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'] as const
const PAGE_SIZES = [25, 50, 100] as const
type PageSize = (typeof PAGE_SIZES)[number]

function pageItems(current: number, total: number): (number | 'ellipsis')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const wanted = new Set([1, total, current - 1, current, current + 1, current - 2, current + 2])
  const nums = [...wanted].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b)
  const out: (number | 'ellipsis')[] = []
  for (const n of nums) {
    const prev = out[out.length - 1]
    if (typeof prev === 'number' && n - prev > 1) out.push('ellipsis')
    out.push(n)
  }
  return out
}

function SortHeader({
  label,
  col,
  sortBy,
  sortDir,
  onSort,
  title,
}: {
  label: string
  col: SortKey
  sortBy: SortKey
  sortDir: 'asc' | 'desc'
  onSort: (col: SortKey) => void
  title?: string
}) {
  const active = sortBy === col
  return (
    <th
      className="table-header text-right cursor-pointer select-none whitespace-nowrap"
      title={title}
      onClick={() => onSort(col)}
    >
      {label}
      {active ? <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span> : null}
    </th>
  )
}

function pagerButtonClass(active: boolean, disabled?: boolean) {
  if (disabled) return 'px-2 py-1 rounded text-xs border border-gray-200 dark:border-gray-700 text-gray-300 dark:text-gray-600 cursor-not-allowed'
  if (active) return 'px-2 py-1 rounded text-xs font-semibold border bg-blue-600 text-white border-blue-600'
  return 'px-2 py-1 rounded text-xs font-semibold border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
}

function PaginationBar({
  page,
  totalPages,
  total,
  pageSize,
  from,
  to,
  onPage,
  onPageSize,
  className = '',
}: {
  page: number
  totalPages: number
  total: number
  pageSize: number
  from: number
  to: number
  onPage: (page: number) => void
  onPageSize: (size: PageSize) => void
  className?: string
}) {
  if (total === 0) return null
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${className}`}>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Showing {from}–{to} of {total}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-1.5 text-xs text-gray-500">
          Per page
          <select
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value) as PageSize)}
            className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={pagerButtonClass(false, page <= 1)} disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Prev
        </button>
        {pageItems(page, totalPages).map((item, i) =>
          item === 'ellipsis' ? (
            <span key={`e${i}`} className="px-1 text-xs text-gray-400">
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              className={pagerButtonClass(item === page)}
              onClick={() => onPage(item)}
            >
              {item}
            </button>
          ),
        )}
        <button
          type="button"
          className={pagerButtonClass(false, page >= totalPages)}
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  )
}

export default function AdpPage() {
  const [visibleSitesRaw, setVisibleSites] = usePersistedState<AdpSiteKey[]>(
    'draft.adp.visibleSites',
    [...ADP_SITES],
  )
  const visibleSites = useMemo(() => {
    const known = new Set(
      visibleSitesRaw.filter((s): s is AdpSiteKey => (ADP_SITES as readonly string[]).includes(s)),
    )
    const ordered = ADP_SITES.filter((s) => known.has(s))
    return ordered.length ? ordered : [...ADP_SITES]
  }, [visibleSitesRaw])
  const [sortBy, setSortBy] = usePersistedState<SortKey>('draft.adp.sortBy', 'blend')
  const [sortDir, setSortDir] = usePersistedState<'asc' | 'desc'>('draft.adp.sortDir', 'asc')
  const [pageSize, setPageSize] = usePersistedState<PageSize>('draft.adp.pageSize', 50)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [posFilter, setPosFilter] = useState<string[]>([])
  const [teamFilter, setTeamFilter] = useState('')
  const debouncedSearch = useDebounce(search, 200)
  const listRef = useRef<HTMLDivElement>(null)
  const posKey = posFilter.join(',')
  const resolvedPageSize: PageSize = PAGE_SIZES.includes(pageSize) ? pageSize : 50

  const sitesKey = visibleSites.join(',')

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, teamFilter, posKey, sortBy, sortDir, resolvedPageSize, sitesKey])

  const queryArgs = useMemo(
    () => ({
      page,
      page_size: resolvedPageSize,
      sort: sortBy,
      sort_dir: sortDir,
      q: debouncedSearch.trim() || undefined,
      team: teamFilter || undefined,
      pos: posFilter.length ? posFilter.join(',') : undefined,
      sites: sitesKey,
    }),
    [page, resolvedPageSize, sortBy, sortDir, debouncedSearch, teamFilter, posFilter, sitesKey],
  )
  const { data, isLoading, isFetching, error } = useGetAdpQuery(queryArgs)
  const [fetchAll] = useLazyGetAdpQuery()

  const players = data?.players ?? []
  const teams = data?.teams ?? []
  const totalCount = data?.total ?? 0
  const totalPages = Math.max(1, data?.total_pages ?? 1)
  const safePage = data?.page ?? page
  const offset = data?.offset ?? 0
  const from = totalCount === 0 ? 0 : offset + 1
  const to = offset + players.length
  const goToPage = (next: number) => {
    setPage(Math.min(Math.max(1, next), totalPages))
    listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const handleSort = (col: SortKey) => {
    if (sortBy === col) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else {
      setSortBy(col)
      setSortDir('asc')
    }
  }

  const toggleSite = (site: AdpSiteKey) => {
    setVisibleSites((prev) => (prev.includes(site) ? prev.filter((s) => s !== site) : [...prev, site]))
  }

  const togglePos = (pos: string) => {
    setPosFilter((prev) => (prev.includes(pos) ? prev.filter((p) => p !== pos) : [...prev, pos]))
  }

  const exportCsv = async () => {
    const result = await fetchAll({
      page: 1,
      page_size: 2000,
      sort: sortBy,
      sort_dir: sortDir,
      q: debouncedSearch.trim() || undefined,
      team: teamFilter || undefined,
      pos: posFilter.length ? posFilter.join(',') : undefined,
      sites: sitesKey,
    }).unwrap()
    const header = [
      'blend_rank',
      'name',
      'team',
      'positions',
      ...visibleSites.flatMap((s) => [`${s}_adp`, `${s}_rank`]),
      'blend',
      'spread',
    ]
    const rows = result.players.map((p) => [
      String(p.blend_rank ?? ''),
      p.name,
      p.team_abbr ?? '',
      p.positions.join('/'),
      ...visibleSites.flatMap((s) => [p[s].adp == null ? '' : String(p[s].adp), p[s].rank == null ? '' : String(p[s].rank)]),
      p.blend == null ? '' : String(p.blend),
      p.spread == null ? '' : String(p.spread),
    ])
    downloadCsv('fantasy-adp.csv', toCsv([header, ...rows]))
  }

  if (isLoading && !data) return <LoadingSpinner />
  if (error) return <ErrorMessage message={getErrorMessage(error, 'Failed to load ADP')} />

  return (
    <div className="max-w-screen-2xl mx-auto px-4 sm:px-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Fantasy Basketball ADP</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Average draft position from ESPN, Fantrax, and Sleeper (fetched live), plus a Blend of the checked
            sites that list the player. Unchecking a site hides its column and recalculates Blend from the rest.
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            Site ADP colors compare that site to Blend.{' '}
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">Green</span> means the site drafts
            the player earlier than Blend;{' '}
            <span className="text-rose-600 dark:text-rose-400 font-medium">red</span> means later. Stronger color
            is a bigger gap (4+ picks).
          </p>
          {data?.updated_at ? (
            <p className="text-xs text-gray-400 mt-1">Updated {formatUpdatedAt(data.updated_at)}</p>
          ) : null}
        </div>
        <div className="flex flex-col items-start sm:items-end gap-1">
          <Link to="/draft/board" className="text-sm text-blue-700 dark:text-blue-300 hover:underline whitespace-nowrap">
            Open draft board
          </Link>
          <Link
            to="/draft/rankings"
            className="text-sm text-blue-700 dark:text-blue-300 hover:underline whitespace-nowrap"
          >
            Open pre-draft rankings
          </Link>
        </div>
      </div>

      <div className="card p-4 mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Sites</span>
          {ADP_SITES.map((site) => (
            <label key={site} className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={visibleSites.includes(site)}
                onChange={() => toggleSite(site)}
                className="rounded border-gray-300"
              />
              {SITE_LABEL[site]}
            </label>
          ))}
          <span
            className="text-xs text-gray-400"
            title="Average ADP across the checked sites that list this player."
          >
            Blend uses checked sites
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search player…"
            className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm w-48"
          />
          <select
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
            className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1.5 text-sm"
          >
            <option value="">All teams</option>
            {teams.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {POSITIONS.map((pos) => (
            <button
              key={pos}
              type="button"
              onClick={() => togglePos(pos)}
              className={`px-2 py-1 rounded text-xs font-semibold border ${
                posFilter.includes(pos)
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'
              }`}
            >
              {pos}
            </button>
          ))}
          {/* CSV UI hidden until a later phase
          <button type="button" onClick={exportCsv} className="btn-primary text-xs py-1.5 px-3 ml-auto">
            Export CSV
          </button>
          */}
        </div>
      </div>

      <div ref={listRef} className={isFetching ? 'opacity-70' : undefined}>
        <div className="card overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className="table-header text-right w-12">#</th>
                  <th className="table-header sticky left-0 z-10 bg-gray-50 dark:bg-gray-800">Player</th>
                  {visibleSites.map((site) => (
                    <SortHeader
                      key={site}
                      label={SITE_LABEL[site]}
                      col={site}
                      sortBy={sortBy}
                      sortDir={sortDir}
                      onSort={handleSort}
                      title={`${SITE_LABEL[site]} ADP`}
                    />
                  ))}
                  <SortHeader
                    label="Blend"
                    col="blend"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={handleSort}
                    title="Average ADP across the checked sites that list this player"
                  />
                  <SortHeader
                    label="Spread"
                    col="spread"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={handleSort}
                    title="Highest checked-site ADP minus lowest"
                  />
                </tr>
              </thead>
              <tbody>
                {players.map((p) => (
                  <tr key={p.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60">
                    <td className="table-cell text-right text-gray-500">{p.blend_rank ?? '—'}</td>
                    <td className="table-cell sticky left-0 z-10 bg-white dark:bg-gray-900">
                      <PlayerIdentityCell
                        name={p.name}
                        playerId={p.espn_id}
                        photoUrl={p.photo_url}
                        teamAbbr={p.team_abbr}
                        positions={p.positions}
                      />
                    </td>
                    {visibleSites.map((site) => (
                      <td key={site} className={`table-cell text-right ${adpDeltaClass(p[site].adp, p.blend)}`}>
                        <div>{formatAdp(p[site].adp)}</div>
                        {p[site].rank != null ? (
                          <div className="text-[10px] text-gray-400 font-normal">#{p[site].rank}</div>
                        ) : null}
                      </td>
                    ))}
                    <td className="table-cell text-right font-semibold">
                      {formatAdp(p.blend)}
                      {p.blend_rank != null ? (
                        <div className="text-[10px] text-gray-400 font-normal">#{p.blend_rank}</div>
                      ) : null}
                    </td>
                    <td className="table-cell text-right text-gray-500">{formatAdp(p.spread)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {players.length === 0 ? (
              <p className="text-center text-sm text-gray-500 py-8">No players match these filters.</p>
            ) : (
              <PaginationBar
                page={safePage}
                totalPages={totalPages}
                total={totalCount}
                pageSize={resolvedPageSize}
                from={from}
                to={to}
                onPage={goToPage}
                onPageSize={setPageSize}
                className="border-t border-gray-200 dark:border-gray-700"
              />
            )}
          </div>
      </div>
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useGetAdpQuery, useLazyGetAdpQuery } from '../../store/api/fantasyApi'
import { usePersistedState } from '../../hooks/usePersistedState'
import { useBlendSites } from '../../hooks/useBlendSites'
import { useDebounce } from '../../hooks/useDebounce'
import { getErrorMessage } from '../../utils/errorMessage'
import LoadingSpinner from '../../components/LoadingSpinner'
import ErrorMessage from '../../components/ErrorMessage'
import PlayerIdentityCell from '../../components/draft/PlayerIdentityCell'
import PaginationBar from '../../components/draft/PaginationBar'
import { resolvePageSize, type PageSize } from '../../utils/pagination'
import {
  BLEND_LABEL,
  DEFAULT_DRAFT_METRIC,
  SITE_LABEL,
  adpDeltaClass,
  blendValue,
  formatAdp,
  formatUpdatedAt,
  isAdpSite,
  siteValue,
  spreadValue,
  type AdpSiteKey,
} from '../../utils/adp'
import { downloadCsv, toCsv } from '../../utils/draftCsv'
import type { AdpMetric, AdpResponse, ProviderMeta } from '../../types/api'

type SortKey = 'blend' | 'spread' | 'name' | 'team' | AdpSiteKey

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'] as const

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


export default function AdpPage() {
  const [metric, setMetric] = usePersistedState<AdpMetric>('draft.adp.metric', DEFAULT_DRAFT_METRIC)
  // Last successful response, kept so a refetch or a failed request leaves the table on
  // screen instead of blanking it.
  const [lastGood, setLastGood] = useState<AdpResponse | undefined>(undefined)
  const [providers, setProviders] = useState<ProviderMeta[] | undefined>(undefined)
  const { sites: visibleSites, available, toggle: toggleSite, sitesParam, rankSitesParam } =
    useBlendSites(metric, providers)
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
  const resolvedPageSize: PageSize = resolvePageSize(pageSize)

  const sitesKey = visibleSites.join(',')

  // A sort column can vanish under the current view: sorting by Fantrax and switching to
  // Rankings leaves every row's sort value null, which silently degrades to a name sort on
  // a column that is not even rendered. Fall back to Blend instead.
  if (isAdpSite(sortBy) && !available.includes(sortBy)) setSortBy('blend')

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, teamFilter, posKey, sortBy, sortDir, resolvedPageSize, sitesKey, metric])

  const queryArgs = useMemo(
    () => ({
      page,
      page_size: resolvedPageSize,
      sort: sortBy,
      sort_dir: sortDir,
      q: debouncedSearch.trim() || undefined,
      team: teamFilter || undefined,
      pos: posFilter.length ? posFilter.join(',') : undefined,
      sites: sitesParam,
      rank_sites: rankSitesParam,
      metric,
    }),
    [
      page,
      resolvedPageSize,
      sortBy,
      sortDir,
      debouncedSearch,
      teamFilter,
      posFilter,
      sitesParam,
      rankSitesParam,
      metric,
    ],
  )
  const { data, isLoading, isFetching, error } = useGetAdpQuery(queryArgs)
  const [fetchAll] = useLazyGetAdpQuery()
  if (data?.providers?.length && data.providers !== providers) setProviders(data.providers)
  if (data && data !== lastGood) setLastGood(data)
  const view = data ?? lastGood

  const players = view?.players ?? []
  const teams = view?.teams ?? []
  const totalCount = view?.total ?? 0
  const totalPages = Math.max(1, view?.total_pages ?? 1)
  const safePage = view?.page ?? page
  const offset = view?.offset ?? 0
  const from = totalCount === 0 ? 0 : offset + 1
  const to = offset + players.length
  // The server clamps the page when the result set shrinks (fewer players on the Rankings
  // view, a site unchecked). Adopt that clamp, or `page` stays above it and Prev steps a
  // page number nothing is rendering. Only while settled and only downward: mid-fetch the
  // hook still reports the previous page, and reacting to that would undo the user's click.
  if (data && !isFetching && safePage < page) setPage(safePage)
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
      sites: sitesParam,
      rank_sites: rankSitesParam,
      metric,
    }).unwrap()
    // ADP-view headers are unchanged: the Chrome extension and any saved sheet parse these
    // exact column names. The Rankings view is a new export with its own header set.
    const header =
      metric === 'adp'
        ? [
            'blend_rank',
            'name',
            'team',
            'positions',
            ...visibleSites.flatMap((s) => [`${s}_adp`, `${s}_rank`]),
            'blend',
            'spread',
          ]
        : [
            'ranking_blend_rank',
            'name',
            'team',
            'positions',
            ...visibleSites.map((s) => `${s}_ranking`),
            'ranking_blend',
            'ranking_spread',
          ]
    const rows = result.players.map((p) =>
      metric === 'adp'
        ? [
            String(p.blend_rank ?? ''),
            p.name,
            p.team_abbr ?? '',
            p.positions.join('/'),
            ...visibleSites.flatMap((s) => [
              p[s].adp == null ? '' : String(p[s].adp),
              p[s].rank == null ? '' : String(p[s].rank),
            ]),
            p.blend == null ? '' : String(p.blend),
            p.spread == null ? '' : String(p.spread),
          ]
        : [
            String(p.ranking_blend_rank ?? ''),
            p.name,
            p.team_abbr ?? '',
            p.positions.join('/'),
            ...visibleSites.map((s) => (p[s].ranking == null ? '' : String(p[s].ranking))),
            p.ranking_blend == null ? '' : String(p.ranking_blend),
            p.ranking_spread == null ? '' : String(p.ranking_spread),
          ],
    )
    downloadCsv(metric === 'adp' ? 'fantasy-adp.csv' : 'fantasy-rankings.csv', toCsv([header, ...rows]))
  }

  if (isLoading && !view) return <LoadingSpinner />
  if (error && !view) return <ErrorMessage message={getErrorMessage(error, 'Failed to load ADP')} />

  return (
    <div className="max-w-screen-2xl mx-auto px-4 sm:px-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">
            {metric === 'adp' ? 'Fantasy Basketball ADP' : 'Fantasy Basketball Rankings'}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {metric === 'adp'
              ? 'Average draft position from the sites below (fetched live), plus a Blend of the checked sites that list the player. Unchecking a site hides its column and recalculates Blend from the rest.'
              : 'Each site’s own published ranking, plus a Blend of the checked sites that rank the player. Rankings are a different scale from ADP, so the two Blends are computed separately and never mixed.'}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            Site colors compare that site to Blend.{' '}
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">Green</span> means the site is
            higher on the player than Blend;{' '}
            <span className="text-rose-600 dark:text-rose-400 font-medium">red</span> means lower. Stronger color
            is a bigger gap (4+ places).
          </p>
          {view?.updated_at ? (
            <p className="text-xs text-gray-400 mt-1">Updated {formatUpdatedAt(view.updated_at)}</p>
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
          {available.map((site) => (
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
            title={`${BLEND_LABEL[metric]} averages the checked sites that list this player.`}
          >
            Blend uses checked sites
          </span>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">View</span>
            <div className="inline-flex rounded-md border border-gray-300 dark:border-gray-600 overflow-hidden">
              {(['adp', 'rank'] as AdpMetric[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setMetric(key)}
                  className={`px-3 py-1 text-xs font-semibold ${
                    metric === key
                      ? 'bg-blue-600 text-white'
                      : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300'
                  }`}
                >
                  {key === 'adp' ? 'ADP' : 'Rankings'}
                </button>
              ))}
            </div>
          </div>
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
          <button type="button" onClick={exportCsv} className="btn-primary text-xs py-1.5 px-3 ml-auto">
            Export CSV
          </button>
        </div>
      </div>

      <div ref={listRef} className={isFetching ? 'opacity-70' : undefined}>
        <div className="card overflow-x-auto">
          {/* Changing page scrolls the list top into view, so the pager has to exist up here
              too -- otherwise every click leaves the controls off-screen below the fold. */}
          <PaginationBar
            page={safePage}
            totalPages={totalPages}
            total={totalCount}
            pageSize={resolvedPageSize}
            from={from}
            to={to}
            onPage={goToPage}
            onPageSize={setPageSize}
            className="border-b border-gray-200 dark:border-gray-700"
          />
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
                      title={`${SITE_LABEL[site]} ${metric === 'adp' ? 'ADP' : 'ranking'}`}
                    />
                  ))}
                  <SortHeader
                    label="Blend"
                    col="blend"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={handleSort}
                    title={`Average ${metric === 'adp' ? 'ADP' : 'ranking'} across the checked sites that list this player`}
                  />
                  <SortHeader
                    label="Spread"
                    col="spread"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={handleSort}
                    title={`Highest checked-site ${metric === 'adp' ? 'ADP' : 'ranking'} minus lowest`}
                  />
                </tr>
              </thead>
              <tbody>
                {players.map((p) => (
                  <tr key={p.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60">
                    <td className="table-cell text-right text-gray-500">
                      {(metric === 'adp' ? p.blend_rank : p.ranking_blend_rank) ?? '—'}
                    </td>
                    <td className="table-cell sticky left-0 z-10 bg-white dark:bg-gray-900">
                      <PlayerIdentityCell
                        name={p.name}
                        playerId={p.espn_id}
                        photoUrl={p.photo_url}
                        teamAbbr={p.team_abbr}
                        positions={p.positions}
                      />
                    </td>
                    {visibleSites.map((site) => {
                      const value = siteValue(p, site, metric)
                      return (
                        <td
                          key={site}
                          className={`table-cell text-right ${adpDeltaClass(value, blendValue(p, metric))}`}
                        >
                          <div>{formatAdp(value)}</div>
                          {metric === 'adp' && p[site].rank != null ? (
                            <div className="text-[10px] text-gray-400 font-normal">#{p[site].rank}</div>
                          ) : null}
                        </td>
                      )
                    })}
                    <td className="table-cell text-right font-semibold">
                      {formatAdp(blendValue(p, metric))}
                      {(metric === 'adp' ? p.blend_rank : p.ranking_blend_rank) != null ? (
                        <div className="text-[10px] text-gray-400 font-normal">
                          #{metric === 'adp' ? p.blend_rank : p.ranking_blend_rank}
                        </div>
                      ) : null}
                    </td>
                    <td className="table-cell text-right text-gray-500">
                      {formatAdp(spreadValue(p, metric))}
                    </td>
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

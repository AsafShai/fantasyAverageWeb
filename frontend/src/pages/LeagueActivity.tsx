import { useMemo } from 'react'
import { useGetLeagueActivityQuery } from '../store/api/fantasyApi'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import { getErrorMessage } from '../utils/errorMessage'
import { usePersistedState } from '../hooks/usePersistedState'
import { enumParam, intParam, stringParam, useUrlState } from '../hooks/useUrlState'
import { orderCategories, type StatMode, type TradeOverrides } from '../utils/leagueActivity'
import ActivityFeed from '../components/activity/ActivityFeed'
import TradesTab from '../components/activity/TradesTab'
import TradeTree from '../components/activity/TradeTree'
import ReleasedPlayers from '../components/activity/ReleasedPlayers'

const TABS = ['activity', 'trades', 'tree', 'released'] as const
type Tab = (typeof TABS)[number]

const TAB_LABEL: Record<Tab, string> = {
  activity: 'Activity',
  trades: 'Trades',
  tree: 'Trade tree',
  released: 'Released players',
}

const URL_SCHEMA = {
  tab: enumParam(TABS, 'activity'),
  trade: stringParam(''),
  team: intParam(0),
}

export default function LeagueActivity() {
  const { data, isLoading, error } = useGetLeagueActivityQuery()
  const [url, setUrl] = useUrlState(URL_SCHEMA)
  const [mode, setMode] = usePersistedState<StatMode>('activity.statMode', 'totals')
  // Players the viewer left out of (or pulled into) a trade's comparison.
  // Kept in this browser only; nobody else sees them.
  const [overrides, setOverrides] = usePersistedState<TradeOverrides>('activity.tradeOverrides', {})
  const categories = useMemo(() => orderCategories(data?.categories ?? []), [data?.categories])

  const selectTrade = (id: string) => setUrl({ tab: 'trades', trade: id })
  const openTree = (tradeId: string, teamId: number) => setUrl({ tab: 'tree', trade: tradeId, team: teamId })

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-xl font-bold text-gray-900 sm:text-2xl dark:text-gray-50">League Activity</h1>
        <p className="mt-1 max-w-prose text-sm text-gray-600 dark:text-gray-300">
          Every add, drop, waiver claim and trade this season. The Trades tab shows what each side of a trade
          actually got while the players were on its roster.
        </p>
      </div>

      <div role="tablist" aria-label="League activity views" className="flex flex-wrap gap-1 border-b border-gray-200 dark:border-gray-700">
        {TABS.map(t => (
          <button
            key={t}
            role="tab"
            type="button"
            id={`activity-tab-${t}`}
            aria-selected={url.tab === t}
            onClick={() => setUrl({ tab: t })}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              url.tab === t
                ? 'border-blue-600 text-blue-700 dark:border-blue-400 dark:text-blue-300'
                : 'border-transparent text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100'
            }`}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : error || !data ? (
        <ErrorMessage message={getErrorMessage(error, 'Failed to load league activity')} />
      ) : (
        <div role="tabpanel" aria-labelledby={`activity-tab-${url.tab}`}>
          {url.tab === 'activity' && <ActivityFeed activity={data} />}
          {url.tab === 'trades' && (
            <TradesTab
              activity={data}
              categories={categories}
              selectedId={url.trade || null}
              onSelect={selectTrade}
              onOpenTree={openTree}
              mode={mode}
              onModeChange={setMode}
              overrides={overrides}
              onOverridesChange={setOverrides}
            />
          )}
          {url.tab === 'tree' && (
            <TradeTree
              activity={data}
              tradeId={url.trade || null}
              teamId={url.team || null}
              onChange={(trade, team) => setUrl({ trade, team })}
              onSelectTrade={selectTrade}
            />
          )}
          {url.tab === 'released' && (
            <ReleasedPlayers activity={data} categories={categories} mode={mode} onModeChange={setMode} />
          )}
        </div>
      )}
    </div>
  )
}

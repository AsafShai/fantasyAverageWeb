import { FF_LEAGUE_ACTIVITY } from '../config/featureFlags'
import { FF_FEATURE_STORE, FF_DRAFT_REPORT, FF_DRAFT_PAGES, FF_BOOM_OR_BUST } from '../config/featureFlags'
import { store } from '../store/store'
import { fantasyApi } from '../store/api/fantasyApi'
import { DEFAULT_DRAFT_METRIC, defaultAdpIndexArgs } from '../utils/adp'

/*
 * The site's navigation, shared by the desktop nav and both phone menus (the
 * old dropdown list and the redesign's ☰ menu sheet), so every layout always
 * offers the same groups and pages.
 */

export interface NavLeaf {
  path: string
  label: string
  icon: string
}

export interface NavGroupDef {
  key: string
  label: string
  icon: string
  items: NavLeaf[]
}

const prefetchMap: Record<string, () => Promise<unknown>> = {
  '/trends': () => import('../pages/Trends'),
  '/projections': () => import('../pages/Projections'),
  '/boom-or-bust': () => import('../pages/BoomOrBust'),
  '/feature-store': () => import('../pages/FeatureStore'),
  '/analytics': () => import('../pages/Analytics'),
  '/shooting-map': () => import('../pages/ShootingMap'),
  '/players': () => import('../pages/Players'),
  '/estimator': () => import('../pages/Estimator'),
  '/draft/rankings-adp': () => import('../pages/draft/AdpPage'),
  '/draft/board': () => import('../pages/draft/DraftBoardPage'),
  '/draft/rankings': () => import('../pages/draft/PreDraftRankingsPage'),
  '/draft/mock': () => import('../pages/draft/MockDraftPage'),
  '/draft/movers': () => import('../pages/draft/MoversPage'),
}

const prefetchDraftData = () => {
  const indexArgs = defaultAdpIndexArgs()
  store.dispatch(fantasyApi.util.prefetch('getAdpIndex', indexArgs, { force: false }))
  store.dispatch(
    fantasyApi.util.prefetch(
      'getAdp',
      {
        page: 1,
        page_size: 50,
        sort: 'blend',
        sort_dir: 'asc',
        metric: DEFAULT_DRAFT_METRIC,
        include_stats: false,
        sites: indexArgs.sites,
        rank_sites: indexArgs.rank_sites,
      },
      { force: false },
    ),
  )
}

export const prefetchRoute = (path: string) => {
  prefetchMap[path]?.()
  if (path.startsWith('/draft/')) prefetchDraftData()
}

const DRAFT_NAV_GROUP: NavGroupDef = {
  key: 'draft',
  label: 'Draft',
  icon: '📝',
  items: [
    { path: '/draft/rankings-adp', label: 'Rankings & ADP', icon: '📊' },
    { path: '/draft/movers', label: 'Movers', icon: '📈' },
    { path: '/draft/board', label: 'Draft Board', icon: '🗂️' },
    { path: '/draft/rankings', label: 'Pre-Draft Rankings', icon: '📋' },
    { path: '/draft/mock', label: 'Mock Draft', icon: '🏟️' },
  ],
}

export function getNavGroups(): NavGroupDef[] {
  return [
    {
      key: 'league',
      label: 'League',
      icon: '👥',
      items: [
        { path: '/', label: 'Today', icon: '📊' },
        { path: '/rankings', label: 'Standings & Rankings', icon: '🏆' },
        { path: '/teams', label: 'Teams', icon: '👥' },
        ...(FF_LEAGUE_ACTIVITY ? [{ path: '/activity', label: 'Activity', icon: '🔁' }] : []),
        ...(FF_DRAFT_REPORT
          ? [
              { path: '/draft-report', label: 'Draft Report', icon: '📝' },
              { path: '/fa-report', label: 'FA Report', icon: '🆓' },
            ]
          : []),
      ],
    },
    {
      key: 'players',
      label: 'Players',
      icon: '⛹️',
      items: [
        { path: '/players', label: 'Players', icon: '⛹️' },
        { path: '/player-rankings', label: 'Player Rankings', icon: '📋' },
      ],
    },
    ...(FF_DRAFT_PAGES ? [DRAFT_NAV_GROUP] : []),
    {
      key: 'insights',
      label: 'Insights',
      icon: '📈',
      items: [
        { path: '/analytics', label: 'League Analytics', icon: '📈' },
        { path: '/trends', label: 'Player Trends', icon: '📉' },
        { path: '/projections', label: 'Projections', icon: '🔭' },
        ...(FF_BOOM_OR_BUST ? [{ path: '/boom-or-bust', label: 'Boom or Bust', icon: '💥' }] : []),
        { path: '/estimator', label: 'Standings Estimator', icon: '🔮' },
        ...(FF_FEATURE_STORE ? [{ path: '/feature-store', label: 'Feature Store', icon: '🗄️' }] : []),
        { path: '/shooting-map', label: 'Player Scatter Map', icon: '🎯' },
      ],
    },
    {
      key: 'tools',
      label: 'Tools',
      icon: '🛠️',
      items: [{ path: '/trade', label: 'Trade Analyzer', icon: '🔄' }],
    },
    {
      key: 'minigames',
      label: 'Minigames',
      icon: '🎮',
      items: [
        { path: '/minigames', label: 'All Games', icon: '🎮' },
        { path: '/minigames/hangman', label: 'Hangman', icon: '🔤' },
        { path: '/minigames/who-he-play-for', label: 'Who He Play For?', icon: '🏟️' },
        { path: '/minigames/who-am-i', label: 'Who Am I?', icon: '🕵️' },
        { path: '/minigames/now-you-see-me', label: 'Now You See Me', icon: '👁️' },
      ],
    },
    {
      key: 'nba',
      label: 'NBA',
      icon: '🏀',
      items: [
        { path: '/nba-teams', label: 'NBA Teams', icon: '🏀' },
        { path: '/box-scores', label: 'Box Scores', icon: '📋' },
        { path: '/schedule', label: 'Season Schedule', icon: '🗓️' },
        { path: '/injuries', label: 'Injuries', icon: '🩺' },
      ],
    },
  ]
}

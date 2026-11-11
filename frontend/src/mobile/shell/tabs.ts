import { FF_BOOM_OR_BUST, FF_DRAFT_PAGES, FF_LEAGUE_ACTIVITY } from '../../config/featureFlags'

/*
 * Everything that can sit in the phone tab bar. A tab is either a page or a
 * shortcut: a tab that follows the user (my team), the calendar (tonight), what
 * was opened last (recent) or just does something (search). The bar itself is
 * chosen in Settings (`tabPrefs.ts`); this file only describes the choices.
 */

export type TabGroup = 'Shortcuts' | 'League' | 'Players' | 'Insights' | 'Tools' | 'NBA' | 'Draft' | 'Minigames'

/** What a shortcut can depend on. */
export interface TabContext {
  myTeamId: number | null
  /** Where the Recent tab goes right now (null: nothing opened yet). */
  recentPath: string | null
}

export interface TabDef {
  id: string
  label: string
  /** SVG path data (24×24, stroked). */
  icon: string
  group: TabGroup
  /** One line under the name in Settings (shortcuts). */
  description?: string
  /** A shortcut that cannot work until a team is chosen in Settings. */
  needsTeam?: boolean
  /** A tab that opens something on this page instead of navigating. */
  action?: 'search' | 'menu'
  /** Destination for the current context; null when the tab has none (an action). */
  to: (ctx: TabContext) => string | null
  /** Whether the current location belongs to this tab. */
  match: (pathname: string, search: string, ctx: TabContext) => boolean
}

const eq = (path: string) => (p: string) => p === path

function page(
  id: string,
  label: string,
  group: TabGroup,
  path: string,
  icon: string,
  match: TabDef['match'] = eq(path),
): TabDef {
  return { id, label, icon, group, to: () => path, match }
}

export const MAX_TABS = 5
export const MIN_TABS = 3

const PAGES: TabDef[] = [
  page('home', 'Home', 'League', '/', 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z'),
  page('standings', 'Standings', 'League', '/rankings', 'M5 20V10M12 20V4M19 20v-7'),
  // The team page belongs to Teams, unless the My Team shortcut claims it.
  page('teams', 'Teams', 'League', '/teams', 'M16 19v-1a4 4 0 0 0-8 0v1M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6', (p) => p === '/teams' || p.startsWith('/team/')),
  ...(FF_LEAGUE_ACTIVITY ? [page('activity', 'Activity', 'League', '/activity', 'M3 12h4l3-7 4 14 3-7h4')] : []),
  page('players', 'Players', 'Players', '/players', 'M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M6 20v-1a6 6 0 0 1 12 0v1'),
  page('player-ranks', 'Player Ranks', 'Players', '/player-rankings', 'M10 6h10M10 12h10M10 18h10M4 5l1.5-1v4M3.5 18.5a1.5 1.5 0 1 1 2.5 1.1L3.5 21H6'),
  page('analytics', 'Analytics', 'Insights', '/analytics', 'M12 3v9h9M12 3a9 9 0 1 0 9 9'),
  page('trends', 'Trends', 'Insights', '/trends', 'M3 17l6-6 4 4 8-8M15 7h6v6'),
  page('projections', 'Projections', 'Insights', '/projections', 'M4 20L20 4M14 4h6v6M4 9V4h5'),
  ...(FF_BOOM_OR_BUST ? [page('boom-or-bust', 'Boom or Bust', 'Insights', '/boom-or-bust', 'M13 3L5 14h6l-1 7 8-11h-6z')] : []),
  page('estimator', 'Estimator', 'Insights', '/estimator', 'M4 4h16v16H4zM4 10h16M10 10v10'),
  page('scatter-map', 'Scatter Map', 'Insights', '/scatter-map', 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8M12 12h.01'),
  page('trade', 'Trade', 'Tools', '/trade', 'M4 8h13l-3-3M20 16H7l3 3'),
  page('nba-teams', 'NBA Teams', 'NBA', '/nba-teams', 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M3 12h18M12 3v18'),
  page('box-scores', 'Box Scores', 'NBA', '/box-scores', 'M4 5h16v14H4zM4 10h16M9 5v14'),
  page('schedule', 'Schedule', 'NBA', '/schedule', 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4'),
  page('injuries', 'Injuries', 'NBA', '/injuries', 'M4 4h16v16H4zM12 8v8M8 12h8'),
  ...(FF_DRAFT_PAGES
    ? [
        page('adp', 'ADP', 'Draft', '/draft/rankings-adp', 'M4 6h16M4 12h10M4 18h6'),
        page('draft-board', 'Draft Board', 'Draft', '/draft/board', 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z'),
        page('mock-draft', 'Mock Draft', 'Draft', '/draft/mock', 'M9 3h6v3H9zM7 4H5v17h14V4h-2M9 11h6M9 15h4'),
      ]
    : []),
  page(
    'minigames',
    'Minigames',
    'Minigames',
    '/minigames',
    'M6 9h12a3 3 0 0 1 3 3v3a3 3 0 0 1-5.2 2L14 15h-4l-1.8 2A3 3 0 0 1 3 15v-3a3 3 0 0 1 3-3zM8 11v3M6.5 12.5h3M16 12h.01M18 14h.01',
    (p) => p === '/minigames' || p.startsWith('/minigames/'),
  ),
]

const SHORTCUTS: TabDef[] = [
  {
    id: 'my-team',
    label: 'My Team',
    group: 'Shortcuts',
    description: 'Straight to your team page',
    needsTeam: true,
    icon: 'M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z',
    to: (ctx) => (ctx.myTeamId == null ? null : `/team/${ctx.myTeamId}`),
    match: (p, _s, ctx) => ctx.myTeamId != null && p === `/team/${ctx.myTeamId}`,
  },
  {
    id: 'tonight',
    label: 'Tonight',
    group: 'Shortcuts',
    description: 'Box scores on today’s date, every day',
    icon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
    to: () => '/box-scores',
    // A past or future date is Box Scores, not Tonight.
    match: (p, s) => p === '/box-scores' && !new URLSearchParams(s).has('date'),
  },
  {
    id: 'recent',
    label: 'Recent',
    group: 'Shortcuts',
    description: 'The last page you opened that is not in the bar',
    icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7v5l3 2',
    action: 'menu',
    to: (ctx) => ctx.recentPath,
    match: () => false,
  },
  {
    id: 'search',
    label: 'Search',
    group: 'Shortcuts',
    description: 'Opens search from the bar',
    icon: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14M16 16l4 4',
    action: 'search',
    to: () => null,
    match: () => false,
  },
]

/** Shortcuts first, then pages: the order Settings offers them in. */
export const CATALOG: TabDef[] = [...SHORTCUTS, ...PAGES]

export const GROUP_ORDER: TabGroup[] = ['Shortcuts', 'League', 'Players', 'Insights', 'Tools', 'NBA', 'Draft', 'Minigames']

export const DEFAULT_TAB_IDS = ['home', 'standings', 'teams', 'player-ranks', 'trade']

export interface TabPreset {
  id: string
  label: string
  tabs: string[]
}

const ALL_PRESETS: TabPreset[] = [
  { id: 'default', label: 'Default', tabs: DEFAULT_TAB_IDS },
  { id: 'my-team', label: 'My team', tabs: ['home', 'my-team', 'tonight', 'standings', 'recent'] },
  { id: 'game-night', label: 'Game night', tabs: ['tonight', 'my-team', 'standings', 'injuries', 'search'] },
  { id: 'draft', label: 'Draft', tabs: ['home', 'adp', 'draft-board', 'mock-draft', 'player-ranks'] },
]

const BY_ID = new Map(CATALOG.map((t) => [t.id, t]))

export function getTab(id: string): TabDef | undefined {
  return BY_ID.get(id)
}

/** Presets whose tabs all exist in this build (Draft needs its flag). */
export const PRESETS: TabPreset[] = ALL_PRESETS.filter((p) => p.tabs.every((id) => BY_ID.has(id)))

/**
 * Index of the tab the location belongs to. A shortcut is the more specific claim
 * (My Team is one team page, Teams is all of them), so it wins whatever the order
 * in the bar; among equals the first one does.
 */
export function currentTabIndex(tabs: TabDef[], pathname: string, search: string, ctx: TabContext): number {
  const hit = (t: TabDef) => t.match(pathname, search, ctx)
  const shortcut = tabs.findIndex((t) => t.group === 'Shortcuts' && hit(t))
  return shortcut !== -1 ? shortcut : tabs.findIndex(hit)
}

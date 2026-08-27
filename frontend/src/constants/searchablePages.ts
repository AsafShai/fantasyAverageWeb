import {
  FF_PLAYER_RANKINGS,
  FF_FEATURE_STORE,
  FF_PROJECTIONS,
  FF_DRAFT_REPORT,
  FF_DRAFT_PAGES,
  FF_TRENDS,
  FF_MINIGAMES,
} from '../config/featureFlags'

export interface SearchablePage {
  label: string
  path: string
  icon: string
  group: string
}

/**
 * Mirrors the real nav entries in Layout.tsx (both the flat nav and the
 * ReorgLayout groups) so the command palette never links to a dead route.
 * Feature-flagged pages are only included when the flag is on for this build.
 */
export const SEARCHABLE_PAGES: SearchablePage[] = [
  { label: 'Dashboard', path: '/', icon: '📊', group: 'League' },
  { label: 'Standings & Rankings', path: '/rankings', icon: '🏆', group: 'League' },
  { label: 'Teams', path: '/teams', icon: '👥', group: 'League' },
  ...(FF_DRAFT_REPORT ? [{ label: 'Draft Report', path: '/draft-report', icon: '📝', group: 'League' }] : []),
  { label: 'Players', path: '/players', icon: '⛹️', group: 'Players' },
  ...(FF_DRAFT_PAGES
    ? [
        { label: 'Rankings & ADP', path: '/draft/rankings-adp', icon: '📊', group: 'Draft' },
        { label: 'Draft Board', path: '/draft/board', icon: '🗂️', group: 'Draft' },
        { label: 'Pre-Draft Rankings', path: '/draft/rankings', icon: '📋', group: 'Draft' },
        { label: 'Mock Draft', path: '/draft/mock', icon: '🏟️', group: 'Draft' },
      ]
    : []),
  ...(FF_PLAYER_RANKINGS ? [{ label: 'Player Rankings', path: '/player-rankings', icon: '📋', group: 'Players' }] : []),
  { label: 'League Analytics', path: '/analytics', icon: '📈', group: 'Insights' },
  ...(FF_TRENDS ? [{ label: 'Player Trends', path: '/trends', icon: '📉', group: 'Insights' }] : []),
  ...(FF_PROJECTIONS ? [{ label: 'Projections', path: '/projections', icon: '🔭', group: 'Insights' }] : []),
  { label: 'Standings Estimator', path: '/estimator', icon: '🔮', group: 'Insights' },
  ...(FF_FEATURE_STORE ? [{ label: 'Feature Store', path: '/feature-store', icon: '🗄️', group: 'Insights' }] : []),
  { label: 'Trade Analyzer', path: '/trade', icon: '🔄', group: 'Tools' },
  ...(FF_MINIGAMES
    ? [
        { label: 'Minigames', path: '/minigames', icon: '🎮', group: 'Minigames' },
        { label: 'Hangman', path: '/minigames/hangman', icon: '🔤', group: 'Minigames' },
        { label: 'Who He Play For?', path: '/minigames/who-he-play-for', icon: '🏟️', group: 'Minigames' },
        { label: 'Who Am I?', path: '/minigames/who-am-i', icon: '🕵️', group: 'Minigames' },
        { label: 'Now You See Me', path: '/minigames/now-you-see-me', icon: '👁️', group: 'Minigames' },
      ]
    : []),
  { label: 'NBA Teams', path: '/nba-teams', icon: '🏀', group: 'NBA' },
  { label: 'Injuries', path: '/injuries', icon: '🩺', group: 'NBA' },
]

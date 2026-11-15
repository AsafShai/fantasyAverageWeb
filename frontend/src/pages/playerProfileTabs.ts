import { enumParam, type UrlSchema } from '../hooks/useUrlState'

export type PlayerTab = 'stats' | 'games' | 'history'
export const PLAYER_TABS: readonly PlayerTab[] = ['stats', 'games', 'history']

export const PLAYER_TAB_OPTIONS: { value: PlayerTab; label: string }[] = [
  { value: 'stats', label: 'Stats' },
  { value: 'games', label: 'Games' },
  { value: 'history', label: 'Fantasy' },
]

export const PLAYER_PROFILE_URL_SCHEMA: UrlSchema<{ tab: PlayerTab }> = {
  tab: enumParam<PlayerTab>(PLAYER_TABS, 'stats'),
}

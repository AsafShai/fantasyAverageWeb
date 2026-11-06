/** Bottom tab bar of the phone shell. The first tab is labelled Home (the Today page). */
export interface TabDef {
  path: string
  label: string
  icon: string
  /** Other routes that belong to this tab (team page under Teams …). */
  match: (pathname: string) => boolean
}

export const TABS: TabDef[] = [
  {
    path: '/',
    label: 'Home',
    icon: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
    match: (p) => p === '/',
  },
  {
    path: '/rankings',
    label: 'Standings',
    icon: 'M5 20V10M12 20V4M19 20v-7',
    match: (p) => p === '/rankings',
  },
  {
    path: '/teams',
    label: 'Teams',
    icon: 'M16 19v-1a4 4 0 0 0-8 0v1M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
    match: (p) => p === '/teams' || p.startsWith('/team/'),
  },
  {
    path: '/players',
    label: 'Players',
    icon: 'M11 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M3 21v-1a6 6 0 0 1 9.5-4.9M17 14v6M14 17h6',
    match: (p) => p === '/players' || p.startsWith('/player/'),
  },
  {
    path: '/trade',
    label: 'Trade',
    icon: 'M4 8h13l-3-3M20 16H7l3 3',
    match: (p) => p === '/trade',
  },
]

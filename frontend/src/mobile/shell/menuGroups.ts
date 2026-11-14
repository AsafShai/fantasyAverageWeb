import type { NavGroupDef } from '../../components/navConfig'

/*
 * Phone menu only (desktop nav unchanged): the groups are master's, with NBA
 * before Minigames and Today called Home like the tab.
 */
export function menuGroups(groups: NavGroupDef[]): NavGroupDef[] {
  const mapped = groups.map((g) =>
    g.key === 'league' ? { ...g, items: g.items.map((i) => (i.path === '/' ? { ...i, label: 'Home', icon: '🏠' } : i)) } : g,
  )
  const nba = mapped.find((g) => g.key === 'nba')
  if (!nba) return mapped
  const rest = mapped.filter((g) => g.key !== 'nba')
  const at = rest.findIndex((g) => g.key === 'minigames')
  return at < 0 ? mapped : [...rest.slice(0, at), nba, ...rest.slice(at)]
}

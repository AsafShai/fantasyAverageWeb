import type { RankMover } from '../../types/api'

/** One team's line in the phone Rank movers card. */
export interface MoverGroup {
  team_id: number
  team_name: string
  /** Roto points change (the TOTAL row), or null when it is not in the filtered rows. */
  total: number | null
  /** Category changes, biggest first. */
  parts: { category: string; delta: number }[]
}

/** 1 → "1", 1.5 → "1.5" (no sign). */
export function formatAbs(delta: number): string {
  const abs = Math.abs(delta)
  return abs % 1 === 0 ? abs.toFixed(0) : abs.toFixed(1)
}

/** "▲5" / "▼6" / "–" (no change or unknown). */
export function arrowDelta(delta: number | null | undefined): string {
  if (delta == null || delta === 0) return '–'
  return `${delta > 0 ? '▲' : '▼'}${formatAbs(delta)}`
}

/** "STL −3", "FG% +1". */
export function partLabel(p: { category: string; delta: number }): string {
  return `${p.category} ${p.delta > 0 ? '+' : '−'}${formatAbs(p.delta)}`
}

/**
 * Groups the per-category mover rows by team: the TOTAL row becomes the big
 * number, the other rows the "STL −3 · 3PM −2" line. My team first, then the
 * biggest total move.
 */
export function groupMovers(movers: RankMover[], myTeamId: number | null): MoverGroup[] {
  const groups = new Map<number, MoverGroup>()
  for (const m of movers) {
    let g = groups.get(m.team_id)
    if (!g) {
      g = { team_id: m.team_id, team_name: m.team_name, total: null, parts: [] }
      groups.set(m.team_id, g)
    }
    if (m.category === 'TOTAL') g.total = m.delta
    else g.parts.push({ category: m.category, delta: m.delta })
  }
  const list = [...groups.values()]
  for (const g of list) g.parts.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  const size = (g: MoverGroup) => Math.abs(g.total ?? 0)
  return list.sort((a, b) => {
    const mine = Number(b.team_id === myTeamId) - Number(a.team_id === myTeamId)
    if (mine) return mine
    return size(b) - size(a) || a.team_name.localeCompare(b.team_name)
  })
}

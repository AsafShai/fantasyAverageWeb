import type { AdpPlayer } from '../types/api'

export type DraftRankingsState = {
  version: 1
  season: string
  order: string[]
  notes: Record<string, string>
  drafted: string[]
}

export const EMPTY_RANKINGS = (season = '2025-26'): DraftRankingsState => ({
  version: 1,
  season,
  order: [],
  notes: {},
  drafted: [],
})

export function notesEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    if ((a[key] ?? '') !== (b[key] ?? '')) return false
  }
  return true
}

export function rankingsEqual(a: DraftRankingsState, b: DraftRankingsState): boolean {
  if (a.order.length !== b.order.length) return false
  if (!a.order.every((id, i) => id === b.order[i])) return false
  if (!notesEqual(a.notes, b.notes)) return false
  if (a.drafted.length !== b.drafted.length) return false
  const left = [...a.drafted].sort()
  const right = [...b.drafted].sort()
  return left.every((id, i) => id === right[i])
}

export function mergeIdsIntoRankings(state: DraftRankingsState, currentIds: string[], season: string): DraftRankingsState {
  const seed = state.order.length > 0 ? state.order : currentIds
  const order = mergeOrder(seed, currentIds)
  const drafted = state.drafted.filter((id) => currentIds.includes(id))
  const same =
    state.season === season &&
    state.order.length === order.length &&
    state.order.every((id, i) => id === order[i]) &&
    drafted.length === state.drafted.length
  if (same) return state
  return { ...state, season, order, drafted }
}

export function mergeOrder(saved: string[], currentIds: string[]): string[] {
  const current = new Set(currentIds)
  const kept = saved.filter((id) => current.has(id))
  const keptSet = new Set(kept)
  return [...kept, ...currentIds.filter((id) => !keptSet.has(id))]
}

export function moveId(order: string[], id: string, toIndex: number): string[] {
  const from = order.indexOf(id)
  if (from < 0) return order
  const next = [...order]
  next.splice(from, 1)
  const clamped = Math.max(0, Math.min(toIndex, next.length))
  next.splice(clamped, 0, id)
  return next
}

export function previewMove(
  order: string[],
  id: string,
  toRank: number,
): { order: string[]; index: number; above: string[]; below: string[] } {
  const maxRank = Math.max(1, order.length)
  const rank = Math.max(1, Math.min(Math.round(toRank) || 1, maxRank))
  const next = moveId(order, id, rank - 1)
  const index = next.indexOf(id)
  return {
    order: next,
    index,
    above: index < 0 ? [] : next.slice(Math.max(0, index - 2), index),
    below: index < 0 ? [] : next.slice(index + 1, index + 3),
  }
}

export function orderedPlayers<T extends { id: string }>(players: T[], order: string[]): T[] {
  const byId = new Map(players.map((p) => [p.id, p]))
  const out: T[] = []
  for (const id of order) {
    const p = byId.get(id)
    if (p) out.push(p)
  }
  for (const p of players) {
    if (!order.includes(p.id)) out.push(p)
  }
  return out
}

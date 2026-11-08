import { isBench } from '../rosterDay'
import { isPlayerInjuryReportUnhealthy } from '../playerInjury'
import type { RosterPlayer } from './types'

const POSITION_SLOTS = new Set(['PG', 'SG', 'SF', 'PF', 'C'])

export function isStarterSlot(slot?: string | null): boolean {
  if (!slot) return false
  return !isBench(slot) && slot !== 'IR'
}

export function playerFillsSlot(positions: string[], slot: string): boolean {
  if (slot === 'UTIL') return true
  if (slot === 'G') return positions.some((p) => p === 'PG' || p === 'SG')
  if (slot === 'F') return positions.some((p) => p === 'SF' || p === 'PF')
  if (POSITION_SLOTS.has(slot)) return positions.includes(slot)
  return false
}

/** Starters on the roster keyed by slot (first wins if duplicates). */
export function startersBySlot(players: RosterPlayer[]): Map<string, RosterPlayer> {
  const map = new Map<string, RosterPlayer>()
  for (const p of players) {
    const slot = p.lineup_slot
    if (!slot || !isStarterSlot(slot)) continue
    if (!map.has(slot)) map.set(slot, p)
  }
  return map
}

export function benchPlayers(players: RosterPlayer[]): RosterPlayer[] {
  return players.filter((p) => p.lineup_slot === 'BE')
}

export function injuredStarters(
  players: RosterPlayer[],
  injuryStatusByPlayerName?: Map<string, string>,
): RosterPlayer[] {
  return players.filter((p) => isPlayerInjuryReportUnhealthy(p, injuryStatusByPlayerName) && isStarterSlot(p.lineup_slot))
}

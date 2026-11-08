import type { RosterDay, RosterDayMove, RosterDayPlayer, RosterDayStats } from '../types/api'
import { addDays, formatSlateDate } from './slateWindow'

// ESPN lineup order: starters, flex, UTIL, then bench and IR.
export const LINEUP_SLOT_ORDER = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'SG/SF', 'G/F', 'PF/C', 'F/C', 'UTIL', 'BE', 'IR']

export function lineupSlotOrder(slot?: string | null): number {
  const idx = slot ? LINEUP_SLOT_ORDER.indexOf(slot) : -1
  return idx === -1 ? 99 : idx
}

export const isBench = (slot: string) => slot === 'BE' || slot === 'IR'

/** Box score landed for this roster day (starters or bench). */
export function rosterDayPlayerPlayed(player: RosterDayPlayer): boolean {
  return player.status === 'played'
}

const EASTERN = 'America/New_York'

function easternTime(iso: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: EASTERN, ...options }).format(new Date(iso))
}

export function dayLabel(date: string): string {
  return formatSlateDate(date, { weekday: 'short', month: 'short', day: 'numeric' })
}

/** The note next to the stepper: when the lineup locked, or why it did not. */
export function lockNote(day: RosterDay, now: Date = new Date()): string {
  if (!day.has_games || !day.lock_at) return 'No NBA games this day'
  const time = `${easternTime(day.lock_at, { hour: 'numeric', minute: '2-digit' })} ET`
  if (!day.is_today) return `Lineup at lock · ${time}`
  return new Date(day.lock_at) > now ? `Live · locks ${time}` : `Live · locked ${time}`
}

// Free-agent pickups are the usual case, so only the others are labelled.
const MOVE_KIND: Record<RosterDayMove['kind'], string | null> = {
  free_agent: null,
  waiver: 'Waiver claim',
  trade: 'Trade',
}

/** When the move was made (ET): just the time on the day itself, with the
 * weekday when it was made the day before (after that day's lock). */
export function moveTime(move: RosterDayMove, date: string): string {
  const sameDay = new Intl.DateTimeFormat('en-CA', { timeZone: EASTERN }).format(new Date(move.at)) === date
  return easternTime(move.at, sameDay ? { hour: 'numeric', minute: '2-digit' } : { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

/** The small note after a move: its kind (when not a free-agent pickup) and
 * whether it came after the previous day's lock. Empty when there is nothing to say. */
export function moveNote(move: RosterDayMove, date: string): string {
  const parts: string[] = []
  const kind = MOVE_KIND[move.kind]
  if (kind) parts.push(kind)
  if (move.after_lock) parts.push(`after ${formatSlateDate(addDays(date, -1), { weekday: 'short' })} lock`)
  return parts.join(' · ')
}

export function pct(made: number, attempted: number): string {
  return attempted > 0 ? `${((made / attempted) * 100).toFixed(2)}%` : '—'
}

export interface StarterTotals extends RosterDayStats {
  games: number
}

/** Totals of the starters who played (bench and IR do not count). */
export function starterTotals(players: RosterDayPlayer[]): StarterTotals {
  const totals: StarterTotals = { games: 0, minutes: 0, fgm: 0, fga: 0, ftm: 0, fta: 0, three_pm: 0, reb: 0, ast: 0, stl: 0, blk: 0, pts: 0, to: 0 }
  for (const player of players) {
    if (isBench(player.lineup_slot) || player.status !== 'played' || !player.stats) continue
    totals.games += 1
    for (const key of Object.keys(player.stats) as (keyof RosterDayStats)[]) {
      totals[key] += player.stats[key] ?? 0
    }
  }
  return totals
}


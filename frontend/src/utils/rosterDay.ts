import type { RosterDay, RosterDayGame, RosterDayMove, RosterDayPlayer, RosterDayStats } from '../types/api'
import { liveMoment, type LiveMoment } from './live'
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
  // Tonight, a player in a game still on counts once he has checked in.
  return player.status === 'played' || (player.status === 'live' && (player.stats?.minutes ?? 0) > 0)
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

/** Totals of the starters who played, tonight's games in progress included (bench and IR do not count). */
export function starterTotals(players: RosterDayPlayer[]): StarterTotals {
  const totals: StarterTotals = { games: 0, minutes: 0, fgm: 0, fga: 0, ftm: 0, fta: 0, three_pm: 0, reb: 0, ast: 0, stl: 0, blk: 0, pts: 0, to: 0 }
  for (const player of players) {
    if (isBench(player.lineup_slot) || (player.status !== 'played' && player.status !== 'live') || !player.stats) continue
    totals.games += 1
    for (const key of Object.keys(player.stats) as (keyof RosterDayStats)[]) {
      totals[key] += player.stats[key] ?? 0
    }
  }
  return totals
}


/**
 * 'live' while today's games are in progress, 'final' once all are final and
 * ESPN is not yet official; null for past days, before tip-off and whenever
 * the response has no live block (backend flag off).
 */
export function liveRosterMoment(day: RosterDay, noSpoilers = false): LiveMoment | null {
  // No spoilers: today stays as it was before live data (opponents only).
  return day.is_today && !noSpoilers ? liveMoment(day.live) : null
}

/** "Played only" fits past days, and today once its games are counted live (or final, ESPN pending). */
export function rosterDayCanFilterPlayed(day: RosterDay, noSpoilers = false): boolean {
  return !day.is_today || liveRosterMoment(day, noSpoilers) !== null
}

/** Starters on court right now: in a game in progress and checked in. */
export function startersPlayingNow(day: RosterDay): number {
  return day.players.filter(p => !isBench(p.lineup_slot) && p.status === 'live' && (p.stats?.minutes ?? 0) > 0).length
}

/** The Roster subtitle and the note next to the stepper. */
export function rosterDayNote(day: RosterDay, now: Date = new Date(), noSpoilers = false): string {
  const moment = liveRosterMoment(day, noSpoilers)
  if (moment === 'final') return 'Final · ESPN official pending'
  if (moment === 'live') {
    const n = startersPlayingNow(day)
    return `Live · ${n} ${n === 1 ? 'starter' : 'starters'} playing now`
  }
  return lockNote(day, now)
}

/**
 * The player's game in a few characters: "W 112–104" when it is over,
 * "78–71 · Q3 4:12" while it is on (his team's score first), the tip time
 * before. (No spoilers hides the whole tag, not just the score.)
 */
export function gameLabel(game: RosterDayGame, opts: { timeZone?: string } = {}): string {
  const score = game.team_score != null && game.opp_score != null ? `${game.team_score}–${game.opp_score}` : ''
  if (game.status === 'final') {
    if (!score) return 'Final'
    const result = game.won === true ? 'W ' : game.won === false ? 'L ' : ''
    const extra = /OT/.test(game.detail) ? ` ${game.detail.replace(/^Final\/?/, '')}` : ''
    return `${result}${score}${extra}`
  }
  if (game.status === 'live') {
    return [score, game.detail].filter(Boolean).join(' · ') || 'Live'
  }
  if (!game.start_time) return ''
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: opts.timeZone }).format(new Date(game.start_time))
}

/** The day in the starters total: "Today, so far" while games are on. */
export function startersDayLabel(day: RosterDay, noSpoilers = false): string {
  if (!day.is_today) return dayLabel(day.date)
  return liveRosterMoment(day, noSpoilers) === 'live' ? 'Today, so far' : 'Today'
}

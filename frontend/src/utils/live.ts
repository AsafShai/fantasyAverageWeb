import type { LiveBlock, TeamTonight } from '../types/api'

export type { LiveBlock }
export type LiveMoment = 'live' | 'final'

export const LIVE_POLL_MS = 60_000

/**
 * What the badge says: 'live' while tonight's games are being counted, 'final'
 * once every one is final but ESPN has not made it official. null for the
 * before-tip-off and ESPN-official moments, and whenever the response has no
 * `live` block (backend flag off), where pages render as they always did.
 */
export function liveMoment(live?: LiveBlock | null): LiveMoment | null {
  if (!live || !live.active) return null
  if (live.games_live === 0 && live.games_total > 0 && live.games_final >= live.games_total) return 'final'
  return 'live'
}

/** Poll only while a game is in progress. */
export function livePollMs(live?: LiveBlock | null): number {
  return live?.active && live.games_live > 0 ? LIVE_POLL_MS : 0
}

export function liveBadgeText(live: LiveBlock, short = false, liveDetail?: 'finished'): string {
  if (liveMoment(live) === 'final') {
    return short ? `${live.games_total} of ${live.games_total}` : `all ${live.games_total} games counted · ESPN official pending`
  }
  if (live.games_live === 0) {
    return short ? `${live.games_final} of ${live.games_total}` : `${live.games_final} of ${live.games_total} games final`
  }
  if (short) return `${live.games_live} of ${live.games_total}`
  return `${live.games_live} of ${live.games_total} games in progress${liveDetail === 'finished' ? ' · finished games counted' : ''}`
}

const games = (n: number) => `${n} ${n === 1 ? 'game' : 'games'}`

/** The "what do the numbers count" line; null when no game is in progress. */
export function averagesNote(live: LiveBlock | undefined | null, mode: 'averages' | 'totals', phone = false): string | null {
  if (!live?.active || live.games_live === 0) return null
  if (phone) {
    return mode === 'averages'
      ? `Averages count finished games only. ${games(live.games_live)} still in progress.`
      : `Totals include the ${games(live.games_live)} in progress.`
  }
  return mode === 'averages'
    ? `Averages count finished games only. ${games(live.games_live)} in progress ${live.games_live === 1 ? 'is' : 'are'} added when ${live.games_live === 1 ? 'it goes' : 'they go'} final.`
    : `Totals include the ${games(live.games_live)} still in progress.`
}

export interface LiveShare {
  tone: LiveMoment
  /** Replaces the card's top-right label. */
  stamp: string
  subtitle: string
  footer: string
}

/** What a share card says when its data is live or final-but-unofficial; null for official data. */
export function liveShare(live?: LiveBlock | null): LiveShare | null {
  const moment = liveMoment(live)
  if (!live || !moment) return null
  const when = live.as_of ? new Date(live.as_of) : new Date()
  const day = `${when.toLocaleDateString('en-US', { weekday: 'short' })} ${when.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
  if (moment === 'final') {
    return { tone: 'final', stamp: 'FINAL · NOT YET OFFICIAL', subtitle: 'Includes all of tonight’s games · ESPN official pending', footer: `Tonight counted, ${day}` }
  }
  const time = live.as_of ? new Date(live.as_of).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : null
  return {
    tone: 'live',
    stamp: time ? `LIVE · ${time}` : 'LIVE',
    subtitle: `Live standings · ${live.games_live} of ${live.games_total} games still in progress`,
    footer: `Live as of ${day}${time ? `, ${time}` : ''}`,
  }
}

/** Short live status for a team-page section subtitle; null when the data is official. */
export function liveSectionNote(live: LiveBlock | undefined | null, section: 'stats' | 'slots'): string | null {
  const moment = liveMoment(live)
  if (!live || !moment) return null
  if (moment === 'final') return 'includes tonight, ESPN official pending'
  return section === 'stats' ? 'live, finished games counted' : `includes ${games(live.games_live)} in progress`
}

// --- Team page: what tonight changed (TeamDetail.tonight) -------------------


const fmtDelta = (n: number) => (Number.isInteger(n) ? String(Math.abs(n)) : String(Math.abs(Math.round(n * 100) / 100)))

/** "+2 tonight" next to games played; null when nothing was added or the data is official. */
export function tonightGp(live: LiveBlock | undefined | null, tonight: TeamTonight | undefined | null): string | null {
  if (!liveMoment(live) || !tonight || tonight.gp <= 0) return null
  return `+${tonight.gp} tonight`
}

/** "▼3 tonight" next to total points; null when unchanged or official. */
export function tonightPoints(live: LiveBlock | undefined | null, tonight: TeamTonight | undefined | null): string | null {
  if (!liveMoment(live) || !tonight || !tonight.points) return null
  return `${tonight.points > 0 ? '▲' : '▼'}${fmtDelta(tonight.points)} tonight`
}

/** A slot-usage row's marker: "+1 live" while games are on, "+1 tonight" once all are final. */
export function slotTonightNote(live: LiveBlock | undefined | null, tonight: TeamTonight | undefined | null, slot: string): string | null {
  const moment = liveMoment(live)
  const n = tonight?.slots?.[slot] ?? 0
  if (!moment || n <= 0) return null
  return `+${n} ${moment === 'live' ? 'live' : 'tonight'}`
}

/** The note in Team statistics while starters are on court. */
export function startersNote(live: LiveBlock | undefined | null, tonight: TeamTonight | undefined | null): string | null {
  if (liveMoment(live) !== 'live' || !tonight || tonight.starters_live <= 0) return null
  const n = tonight.starters_live
  return n === 1
    ? '1 starter is playing now. Averages and ranks below update when his game goes final; tonight’s stats so far are in the roster table.'
    : `${n} starters are playing now. Averages and ranks below update when their game goes final; tonight’s stats so far are in the roster table.`
}

import type { LiveBlock } from '../types/api'

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

export function liveBadgeText(live: LiveBlock, short = false): string {
  if (liveMoment(live) === 'final') {
    return short ? `${live.games_total} of ${live.games_total}` : `all ${live.games_total} games counted · ESPN official pending`
  }
  if (live.games_live === 0) {
    return short ? `${live.games_final} of ${live.games_total}` : `${live.games_final} of ${live.games_total} games final`
  }
  return short ? `${live.games_live} of ${live.games_total}` : `${live.games_live} of ${live.games_total} games in progress`
}

const games = (n: number) => `${n} ${n === 1 ? 'game' : 'games'}`

/** The "what do the numbers count" line; null when no game is in progress. */
export function averagesNote(live: LiveBlock | undefined | null, mode: 'averages' | 'totals'): string | null {
  if (!live?.active || live.games_live === 0) return null
  return mode === 'averages'
    ? `Averages count finished games only. ${games(live.games_live)} in progress ${live.games_live === 1 ? 'is' : 'are'} added when ${live.games_live === 1 ? 'it goes' : 'they go'} final.`
    : `Totals include the ${games(live.games_live)} still in progress.`
}

export interface LiveShare {
  tone: LiveMoment
  /** Replaces the card's top-right label. */
  stamp: string
  subtitle: string
}

/** What a share card says when its data is live or final-but-unofficial; null for official data. */
export function liveShare(live?: LiveBlock | null): LiveShare | null {
  const moment = liveMoment(live)
  if (!live || !moment) return null
  if (moment === 'final') {
    return { tone: 'final', stamp: 'FINAL · NOT YET OFFICIAL', subtitle: 'Includes all of tonight’s games · ESPN official pending' }
  }
  const time = live.as_of ? new Date(live.as_of).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : null
  return {
    tone: 'live',
    stamp: time ? `LIVE · ${time}` : 'LIVE',
    subtitle: `Live standings · ${live.games_live} of ${live.games_total} games still in progress`,
  }
}

/** Short live status for a team-page section subtitle; null when the data is official. */
export function liveSectionNote(live: LiveBlock | undefined | null, section: 'stats' | 'slots'): string | null {
  const moment = liveMoment(live)
  if (!live || !moment) return null
  if (moment === 'final') return 'includes tonight, ESPN official pending'
  return section === 'stats' ? 'live, finished games counted' : `includes ${games(live.games_live)} in progress`
}

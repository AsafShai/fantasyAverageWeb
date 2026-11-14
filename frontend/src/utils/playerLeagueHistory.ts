import type { PlayerHistoryMove, PlayerHistoryStint } from '../types/activity'

/** Hand-picked, most distinct first. A player's teams take them in the order he
 *  joined them, so the 2-4 teams most players have get blue, orange, green, purple. */
export const TEAM_COLORS = [
  '#3b82f6', '#f97316', '#22a06b', '#8b5cf6', '#eab308', '#ef4444',
  '#14b8a6', '#a16207', '#6366f1', '#84cc16', '#06b6d4',
] as const

export function teamColors(stints: PlayerHistoryStint[]): Map<number, string> {
  const colors = new Map<number, string>()
  for (const s of stints) {
    if (!colors.has(s.team_id)) colors.set(s.team_id, TEAM_COLORS[colors.size % TEAM_COLORS.length])
  }
  return colors
}

export interface TimelineSegment {
  /** null: not on any roster (free agent or on waivers). */
  teamId: number | null
  start: number
  end: number
  /** Still on this team (or still unrostered) today. */
  current: boolean
}

/** Draft day to `now`, split into stints and the unrostered gaps between them. */
export function timelineSegments(stints: PlayerHistoryStint[], firstMoveAt: number, now: number): TimelineSegment[] {
  const out: TimelineSegment[] = []
  let t = firstMoveAt
  for (const s of stints) {
    const start = Date.parse(s.start)
    const end = s.end ? Date.parse(s.end) : now
    if (start > t) out.push({ teamId: null, start: t, end: start, current: false })
    out.push({ teamId: s.team_id, start, end: Math.max(end, start), current: !s.end })
    t = Math.max(t, end)
  }
  if (now > t) out.push({ teamId: null, start: t, end: now, current: true })
  return out
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "5 min", "3 hours", "11 days". */
export function formatSpan(ms: number): string {
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MINUTE))} min`
  if (ms < DAY) {
    const h = Math.round(ms / HOUR)
    return `${h} ${h === 1 ? 'hour' : 'hours'}`
  }
  const d = Math.round(ms / DAY)
  return `${d} ${d === 1 ? 'day' : 'days'}`
}

export const isShortSpan = (ms: number) => ms < DAY

export interface HistorySummary {
  draftPick: number | null
  teams: number
  dropped: number
  traded: number
  longestStayMs: number
}

export function historySummary(moves: PlayerHistoryMove[], stints: PlayerHistoryStint[], now: number): HistorySummary {
  const draft = moves.find((m) => m.kind === 'draft')
  return {
    draftPick: draft?.pick ?? null,
    teams: new Set(stints.map((s) => s.team_id)).size,
    dropped: moves.filter((m) => m.kind === 'drop').length,
    traded: moves.filter((m) => m.kind === 'trade').length,
    longestStayMs: Math.max(0, ...stints.map((s) => (s.end ? Date.parse(s.end) : now) - Date.parse(s.start))),
  }
}

/**
 * Who was on the floor when, rebuilt from the play-by-play.
 *
 * Pure functions only: the Rotation card renders what `buildRotation` returns.
 * Times are game seconds from the opening tip (Q1 12:00 = 0, Q4 0:00 = 2880,
 * each overtime adds 300).
 */
import type { BoxPlay, BoxPlayerLine, BoxTeamBox, GameBoxScore } from '../../types/boxScore'

export type Side = 'away' | 'home'
/** [away, home] */
export type Score = readonly [number, number]

export interface Span {
  start: number
  end: number
  /** Score when the span began and when it ended. */
  startScore: Score
  endScore: Score
  /** Still running: the game is live and the span reaches the latest play. */
  open: boolean
}

export interface PlayerRotation {
  id: string
  player: BoxPlayerLine
  starter: boolean
  stints: Span[]
}

export interface TeamRotation {
  side: Side
  /** Players who played: starters then bench, box order. */
  players: PlayerRotation[]
}

export interface Rotation {
  /** Periods on the timeline: 4, or more with overtime. */
  periods: number
  /** Length of the timeline in seconds. */
  total: number
  live: boolean
  /** Game time of the latest play while live, else null. */
  now: number | null
  away: TeamRotation
  home: TeamRotation
}

export const QUARTER = 720
export const OVERTIME = 300
/** Stints shorter than this are bookkeeping noise (a same-clock swap). */
const MIN_STINT = 1
const EPS = 0.05

export function periodStart(period: number): number {
  return period <= 4 ? (period - 1) * QUARTER : 4 * QUARTER + (period - 5) * OVERTIME
}

export function periodLength(period: number): number {
  return period <= 4 ? QUARTER : OVERTIME
}

export function periodEnd(period: number): number {
  return periodStart(period) + periodLength(period)
}

export function timelineLength(periods: number): number {
  return periodEnd(Math.max(4, periods))
}

export function periodName(period: number): string {
  if (period <= 4) return `Q${period}`
  if (period === 5) return 'OT'
  return `${period - 4}OT`
}

/** "5:14" → 314, "0:42.8" → 42.8. NaN when it cannot be read. */
export function clockSeconds(clock: string): number {
  const match = /^(\d+):(\d+(?:\.\d+)?)$/.exec(clock.trim())
  if (!match) {
    const plain = Number(clock)
    return clock.trim() !== '' && Number.isFinite(plain) ? plain : NaN
  }
  return Number(match[1]) * 60 + Number(match[2])
}

export function gameTime(period: number, clock: string): number {
  const left = clockSeconds(clock)
  const length = periodLength(period)
  const remaining = Number.isFinite(left) ? Math.min(Math.max(left, 0), length) : length
  return periodStart(period) + length - remaining
}

/** Which period a game time falls in. An end exactly on a break belongs to the period it closes. */
export function periodAt(t: number, isEnd = false): number {
  const time = isEnd ? t - 1e-6 : t
  if (time < 4 * QUARTER) return Math.max(1, Math.floor(time / QUARTER) + 1)
  return 5 + Math.floor((time - 4 * QUARTER) / OVERTIME)
}

export function mmss(seconds: number): string {
  const v = Math.max(0, Math.round(seconds))
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`
}

/** Game time → "Q2 3:32" / "OT 1:05". */
export function clockLabel(t: number, isEnd = false): string {
  const p = periodAt(t, isEnd)
  return `${periodName(p)} ${mmss(periodEnd(p) - t)}`
}

/** "Q2 3:32 → 0:05" inside one period, "Q2 5:14 → Q3 6:12" across a break, "Q3 4:12 → now" while running. */
export function rangeLabel(span: Pick<Span, 'start' | 'end' | 'open'>): string {
  const a = clockLabel(span.start, false)
  if (span.open) return `${a} → now`
  const b = clockLabel(span.end, true)
  const [pa] = a.split(' ')
  const [pb, cb] = b.split(' ')
  return pa === pb ? `${a} → ${cb}` : `${a} → ${b}`
}

export function margin(side: Side, score: Score): number {
  return side === 'away' ? score[0] - score[1] : score[1] - score[0]
}

/** Score change for this side while the span ran. */
export function spanPlusMinus(side: Side, span: Span): number {
  return margin(side, span.endScore) - margin(side, span.startScore)
}

export function totalPlusMinus(side: Side, spans: Span[]): number {
  return spans.reduce((sum, span) => sum + spanPlusMinus(side, span), 0)
}

export function seconds(spans: Pick<Span, 'start' | 'end'>[]): number {
  return spans.reduce((sum, span) => sum + span.end - span.start, 0)
}

/**
 * Time both lists were on the floor at once. Each piece keeps the score at its
 * edges: its start is someone's check-in and its end someone's check-out (or now).
 */
export function intersect(a: Span[], b: Span[]): Span[] {
  const out: Span[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i].start, b[j].start)
    const end = Math.min(a[i].end, b[j].end)
    if (end - start > 0.5) {
      out.push({
        start,
        end,
        startScore: a[i].start >= b[j].start ? a[i].startScore : b[j].startScore,
        endScore: a[i].end <= b[j].end ? a[i].endScore : b[j].endScore,
        open: a[i].open && b[j].open && a[i].end === end && b[j].end === end,
      })
    }
    if (a[i].end < b[j].end) i++
    else j++
  }
  return out
}

/** Stretches when every one of these players was on the floor. */
export function together(lists: Span[][]): Span[] {
  if (lists.length === 0) return []
  return lists.slice(1).reduce((acc, list) => intersect(acc, list), lists[0])
}

/** Seconds of [from, to] covered by the spans. */
export function overlapSeconds(spans: Pick<Span, 'start' | 'end'>[], from: number, to: number): number {
  return spans.reduce((sum, span) => sum + Math.max(0, Math.min(span.end, to) - Math.max(span.start, from)), 0)
}

// ── building ──

interface Indexed {
  play: BoxPlay
  /** Position in the game's play list. */
  order: number
  t: number
}

const scoreOf = (play: BoxPlay): Score => [play.away_score, play.home_score]
const isFoul = (play: BoxPlay) => /foul/i.test(play.text)
const isSub = (play: BoxPlay) => play.kind === 'sub' && (play.athlete_ids?.length ?? 0) >= 2

function isOpening(play: BoxPlay): boolean {
  const left = clockSeconds(play.clock)
  return Number.isFinite(left) && Math.abs(left - periodLength(play.period)) < 1e-6
}

/**
 * One period's plays in order, with subs at the opening clock moved first:
 * ESPN sometimes logs the period's opening subs after the jump ball.
 */
function periodPlays(all: Indexed[], period: number): Indexed[] {
  const rows = all.filter(row => row.play.period === period)
  const opening = rows.filter(row => isSub(row.play) && isOpening(row.play))
  const rest = rows.filter(row => !(isSub(row.play) && isOpening(row.play)))
  return [...opening, ...rest]
}

/**
 * Score at a sub: the sub's own row, moved on by later rows at the same clock
 * up to (not including) a foul. Free throws after a foul belong to the five
 * that was on the floor when it was called.
 */
function scoreAtSub(rows: Indexed[], index: number): Score {
  const sub = rows[index].play
  let score = scoreOf(sub)
  for (let k = index + 1; k < rows.length; k++) {
    const next = rows[k].play
    if (next.clock !== sub.clock) break
    if (isFoul(next)) break
    score = scoreOf(next)
  }
  return score
}

/** Players of this team who started the period, by their first row in it. */
function startersByFirstPlay(rows: Indexed[], ids: string[]): Set<string> {
  const firstRow = new Map<string, BoxPlay>()
  for (const { play } of rows) {
    for (const id of play.athlete_ids ?? []) {
      if (!firstRow.has(id)) firstRow.set(id, play)
    }
  }
  const out = new Set<string>()
  for (const id of ids) {
    const play = firstRow.get(id)
    if (!play) continue
    const entered = isSub(play) && play.athlete_ids![0] === id
    if (!entered) out.add(id)
  }
  return out
}

/**
 * The five that started the period in progress: ESPN's on-court five with this
 * period's subs undone, newest first. Opening-clock subs are skipped (the result
 * is the five after them) and so are repeated "enters" for a player who never
 * left, which ESPN sometimes logs twice.
 */
function startersFromOnCourt(teamSubs: Indexed[], onCourt: string[]): Set<string> {
  const counted: Indexed[] = []
  const entered = new Set<string>()
  for (const row of teamSubs) {
    if (isOpening(row.play)) continue
    const [inId, outId] = row.play.athlete_ids!
    if (entered.has(inId)) continue
    entered.add(inId)
    entered.delete(outId)
    counted.push(row)
  }
  const five = new Set(onCourt)
  for (let k = counted.length - 1; k >= 0; k--) {
    const [inId, outId] = counted[k].play.athlete_ids!
    if (!five.has(inId)) continue
    five.delete(inId)
    five.add(outId)
  }
  return five
}

function mergeStints(stints: Span[]): Span[] {
  const sorted = [...stints].sort((a, b) => a.start - b.start)
  const out: Span[] = []
  for (const stint of sorted) {
    const last = out[out.length - 1]
    if (last && stint.start - last.end < EPS) {
      if (stint.end > last.end) {
        out[out.length - 1] = { ...last, end: stint.end, endScore: stint.endScore, open: stint.open }
      }
    } else {
      out.push({ ...stint })
    }
  }
  return out.filter(stint => stint.end - stint.start >= MIN_STINT)
}

function teamRotation(
  side: Side,
  team: BoxTeamBox,
  plays: Indexed[],
  lastPeriod: number,
  live: { period: number; now: number } | null,
): TeamRotation {
  const lines = [...team.starters, ...team.bench].filter(line => line.player_id)
  const ids = lines.map(line => String(line.player_id))
  const idSet = new Set(ids)
  const stints = new Map<string, Span[]>(ids.map(id => [id, []]))
  let carry: Score = [0, 0]

  for (let period = 1; period <= lastPeriod; period++) {
    const rows = periodPlays(plays, period)
    const start = periodStart(period)
    const startScore = carry
    const inProgress = live !== null && period === live.period
    const end = inProgress ? live.now : periodEnd(period)
    const endScore: Score = rows.length > 0 ? scoreOf(rows.reduce((a, b) => (b.order > a.order ? b : a)).play) : carry
    const teamSubs = rows.filter(row => isSub(row.play) && row.play.athlete_ids!.some(id => idSet.has(id)))

    let five: Set<string>
    if (period === 1) {
      five = new Set(team.starters.map(line => String(line.player_id)).filter(Boolean))
    } else if (inProgress) {
      const onCourt = lines.filter(line => line.on_court).map(line => String(line.player_id))
      five = onCourt.length === 5 ? startersFromOnCourt(teamSubs, onCourt) : startersByFirstPlay(rows, ids)
    } else {
      five = startersByFirstPlay(rows, ids)
    }

    const onFloor = new Map<string, { start: number; score: Score }>()
    for (const id of five) if (idSet.has(id)) onFloor.set(id, { start, score: startScore })

    rows.forEach((row, index) => {
      if (!isSub(row.play)) return
      const [inId, outId] = row.play.athlete_ids!
      if (!idSet.has(inId) && !idSet.has(outId)) return
      // A repeated "enters" for a player already on the floor changes nothing.
      if (onFloor.has(inId)) return
      const t = row.t
      const score = scoreAtSub(rows, index)
      const leaving = onFloor.get(outId)
      if (leaving) {
        stints.get(outId)!.push({ start: leaving.start, end: t, startScore: leaving.score, endScore: score, open: false })
        onFloor.delete(outId)
      }
      if (idSet.has(inId)) onFloor.set(inId, { start: t, score })
    })

    for (const [id, on] of onFloor) {
      stints.get(id)!.push({ start: on.start, end, startScore: on.score, endScore, open: inProgress })
    }
    carry = endScore
  }

  const players: PlayerRotation[] = []
  lines.forEach((line, index) => {
    const id = ids[index]
    const merged = mergeStints(stints.get(id) ?? [])
    if (merged.length === 0) return
    players.push({ id, player: line, starter: index < team.starters.length, stints: merged })
  })
  return { side, players }
}

/**
 * Rebuilds both teams' rotations. Null when the box has no play-by-play, or
 * it was cached before plays carried player ids.
 */
export function buildRotation(game: GameBoxScore): Rotation | null {
  const raw = game.plays ?? []
  if (raw.length === 0) return null
  if (!raw.some(play => play.kind === 'sub' && (play.athlete_ids?.length ?? 0) >= 2)) return null
  if (game.status === 'scheduled') return null

  const plays: Indexed[] = raw
    .filter(play => play.period >= 1)
    .map((play, order) => ({ play, order, t: gameTime(play.period, play.clock) }))
  if (plays.length === 0) return null
  const maxPeriod = plays.reduce((m, row) => Math.max(m, row.play.period), 0)
  const periods = Math.max(4, game.periods.length, maxPeriod)
  const isLive = game.status === 'live'
  let live: { period: number; now: number } | null = null
  let now: number | null = null
  let lastPeriod = periods
  if (isLive) {
    const latest = plays[plays.length - 1]
    lastPeriod = latest.play.period
    if (latest.play.kind === 'period') {
      // Between periods: the latest row closed one and nothing is running.
      now = periodEnd(latest.play.period)
    } else {
      live = { period: latest.play.period, now: latest.t }
      now = latest.t
    }
  }

  return {
    periods,
    total: timelineLength(periods),
    live: isLive,
    now,
    away: teamRotation('away', game.away, plays, lastPeriod, live),
    home: teamRotation('home', game.home, plays, lastPeriod, live),
  }
}

/** Minutes the rebuilt stints add up to, for checks against the box MIN. */
export function rebuiltMinutes(player: PlayerRotation): number {
  return seconds(player.stints) / 60
}

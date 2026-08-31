import { isMockComplete, isUserOnTheClock, pickCount, type MockSession } from './mockDraft'

const SESSION_KEY = 'fw:draft.mock.session.v1'
const QUEUE_KEY = 'fw:draft.mock.queue.v1'
const CLOCK_KEY = 'fw:draft.mock.clock.v1'
const PAUSED_KEY = 'fw:draft.mock.paused.v1'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isValidPick(value: unknown): boolean {
  if (!isObject(value)) return false
  return (
    isFiniteNumber(value.pick) &&
    isFiniteNumber(value.team) &&
    isFiniteNumber(value.round) &&
    isFiniteNumber(value.pickInRound) &&
    typeof value.playerId === 'string'
  )
}

function isValidPlayer(value: unknown): boolean {
  if (!isObject(value)) return false
  return typeof value.id === 'string' && typeof value.name === 'string' && isStringArray(value.positions)
}

function isValidRoster(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  return value.every(
    (fill) =>
      isObject(fill) &&
      typeof fill.slot === 'string' &&
      (fill.player === null || isValidPlayer(fill.player)),
  )
}

export function isValidMockSession(value: unknown): value is MockSession {
  if (!isObject(value)) return false
  if (
    !isFiniteNumber(value.teams) ||
    !isFiniteNumber(value.rounds) ||
    !isFiniteNumber(value.userTeam) ||
    !isFiniteNumber(value.botDelaySec) ||
    !isFiniteNumber(value.userClockSec) ||
    typeof value.threeRr !== 'boolean'
  ) {
    return false
  }
  if (!isStringArray(value.defaultOrder) || !isStringArray(value.userOrder)) return false
  if (!isObject(value.players) || !Object.values(value.players).every(isValidPlayer)) return false
  if (!Array.isArray(value.picks) || !value.picks.every(isValidPick)) return false
  if (!isObject(value.rosters) || !Object.values(value.rosters).every(isValidRoster)) return false
  if (value.picks.length > pickCount(value.teams, value.rounds)) return false
  const players = value.players
  return value.picks.every((pick) => isObject(pick) && typeof pick.playerId === 'string' && pick.playerId in players)
}

export function readMockSession(): MockSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isValidMockSession(parsed)) {
      localStorage.removeItem(SESSION_KEY)
      return null
    }
    return parsed
  } catch {
    clearMockSession()
    return null
  }
}

export function writeMockSession(session: MockSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    // private browsing / quota exceeded — persistence is best-effort
  }
}

export function clearMockSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {
    // ignore
  }
}

export function readMockQueue(): string[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    return isStringArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function writeMockQueue(queue: string[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
  } catch {
    // ignore
  }
}

export function clearMockQueue(): void {
  try {
    localStorage.removeItem(QUEUE_KEY)
  } catch {
    // ignore
  }
}

/**
 * Seconds left on the clock, not an absolute deadline — a stale timestamp would
 * restore as already expired and auto-pick the moment the page loaded.
 */
export function readMockClock(): number | null {
  try {
    const raw = localStorage.getItem(CLOCK_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isFiniteNumber(parsed) || parsed <= 0) return null
    return parsed
  } catch {
    return null
  }
}

export function writeMockClock(secondsLeft: number): void {
  try {
    localStorage.setItem(CLOCK_KEY, JSON.stringify(secondsLeft))
  } catch {
    // ignore
  }
}

export function clearMockClock(): void {
  try {
    localStorage.removeItem(CLOCK_KEY)
  } catch {
    // ignore
  }
}

export function readMockPaused(): boolean {
  try {
    return localStorage.getItem(PAUSED_KEY) === 'true'
  } catch {
    return false
  }
}

export function writeMockPaused(paused: boolean): void {
  try {
    localStorage.setItem(PAUSED_KEY, paused ? 'true' : 'false')
  } catch {
    // ignore
  }
}

export function clearMockPaused(): void {
  try {
    localStorage.removeItem(PAUSED_KEY)
  } catch {
    // ignore
  }
}

/**
 * A restored draft resumes running, except when the user's own pick is on the
 * clock with a finite timer — that would auto-pick for them while they are
 * still working out what happened to the page.
 */
export function shouldRestorePaused(session: MockSession): boolean {
  if (isMockComplete(session)) return false
  if (!isUserOnTheClock(session)) return false
  return session.userClockSec > 0
}

import { clampLeagueSettings, draftTeamForPick, DEFAULT_LEAGUE_SETTINGS, type LeagueBoardSettings } from './adp'
import { mergeOrder } from './draftRankings'

export type MockDraftSlot = 'PG' | 'SG' | 'SF' | 'PF' | 'C' | 'G' | 'F' | 'UTIL' | 'BE'
export type RosterPhase = 'starter' | 'flex' | 'bench'
export type RankingSource = 'saved' | 'default' | 'csv'

export const CORE_SLOTS: MockDraftSlot[] = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL', 'UTIL', 'UTIL']
const STARTER_SLOTS: MockDraftSlot[] = ['PG', 'SG', 'SF', 'PF', 'C']
const FLEX_SLOTS: MockDraftSlot[] = ['G', 'F', 'UTIL']

export type MockDraftSettings = LeagueBoardSettings & {
  userPick: number
  botDelaySec: number
  userClockSec: number
  rankingSource: RankingSource
}

export const DEFAULT_MOCK_SETTINGS: MockDraftSettings = {
  ...DEFAULT_LEAGUE_SETTINGS,
  userPick: 1,
  botDelaySec: 0,
  userClockSec: 60,
  rankingSource: 'default',
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}

export function clampMockSettings(raw?: Partial<MockDraftSettings> | null): MockDraftSettings {
  const league = clampLeagueSettings(raw)
  const botDelay = raw?.botDelaySec ?? DEFAULT_MOCK_SETTINGS.botDelaySec
  const clock = raw?.userClockSec ?? DEFAULT_MOCK_SETTINGS.userClockSec
  const source = raw?.rankingSource
  return {
    ...league,
    userPick: clampInt(raw?.userPick ?? 1, 1, league.teams),
    botDelaySec: botDelay === 0 ? 0 : clampInt(botDelay, 1, 10),
    userClockSec: clock === 30 || clock === 60 ? clock : 0,
    rankingSource: source === 'saved' || source === 'csv' ? source : 'default',
  }
}

export function pickCount(teams: number, rounds: number): number {
  return teams * rounds
}

export function csvHasEnoughPlayers(matched: number, teams: number, rounds: number): boolean {
  return matched >= pickCount(teams, rounds)
}

export function buildUserOrder(
  defaultIds: string[],
  source: RankingSource,
  savedOrder: string[],
  csvOrder: string[],
): string[] {
  if (source === 'saved' && savedOrder.length) return mergeOrder(savedOrder, defaultIds)
  if (source === 'csv' && csvOrder.length) return mergeOrder(csvOrder, defaultIds)
  return defaultIds
}

export function rosterSlots(rounds: number): MockDraftSlot[] {
  const bench = Math.max(0, rounds - CORE_SLOTS.length)
  return [...CORE_SLOTS, ...Array.from({ length: bench }, () => 'BE' as const)]
}

export type RosterSlotFill<T> = { slot: MockDraftSlot; player: T | null }

export function emptyRoster<T>(rounds: number): RosterSlotFill<T>[] {
  return rosterSlots(rounds).map((slot) => ({ slot, player: null }))
}

export function playerFitsSlot(positions: string[], slot: MockDraftSlot): boolean {
  const pos = new Set(positions.map((p) => p.toUpperCase()))
  if (slot === 'UTIL' || slot === 'BE') return true
  if (slot === 'G') return pos.has('PG') || pos.has('SG')
  if (slot === 'F') return pos.has('SF') || pos.has('PF')
  return pos.has(slot)
}

export const COUNTED_POSITIONS: MockDraftSlot[] = ['PG', 'SG', 'SF', 'PF', 'C']

/**
 * Counts how many drafted players are eligible at each base position. A player
 * with a secondary position is counted once for every position they list, so
 * the totals sum to more than the roster size.
 */
export function rosterPositionCounts<T extends { positions: string[] }>(
  roster: RosterSlotFill<T>[],
): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(COUNTED_POSITIONS.map((p) => [p, 0]))
  for (const row of roster) {
    if (!row.player) continue
    for (const pos of new Set(row.player.positions.map((p) => p.toUpperCase()))) {
      if (pos in counts) counts[pos] += 1
    }
  }
  return counts
}

export function hasOpenSlotFor<T>(roster: RosterSlotFill<T>[], positions: string[]): boolean {
  return roster.some((s) => !s.player && playerFitsSlot(positions, s.slot))
}

export function rosterPhase(roster: RosterSlotFill<unknown>[]): RosterPhase {
  if (roster.some((s) => STARTER_SLOTS.includes(s.slot) && !s.player)) return 'starter'
  if (roster.some((s) => FLEX_SLOTS.includes(s.slot) && !s.player)) return 'flex'
  return 'bench'
}

function emptySlotsInPhase<T>(roster: RosterSlotFill<T>[], phase: RosterPhase): RosterSlotFill<T>[] {
  if (phase === 'starter') return roster.filter((s) => STARTER_SLOTS.includes(s.slot) && !s.player)
  if (phase === 'flex') return roster.filter((s) => FLEX_SLOTS.includes(s.slot) && !s.player)
  return roster.filter((s) => s.slot === 'BE' && !s.player)
}

export function assignToRoster<T extends { positions: string[] }>(
  roster: RosterSlotFill<T>[],
  player: T,
): RosterSlotFill<T>[] {
  const next = roster.map((s) => ({ ...s }))
  const fit = next.findIndex((s) => !s.player && playerFitsSlot(player.positions, s.slot))
  const idx = fit >= 0 ? fit : next.findIndex((s) => !s.player)
  if (idx >= 0) next[idx] = { ...next[idx], player }
  return next
}

export function moveSlotLabel(slot: MockDraftSlot): string {
  return slot === 'BE' ? 'Bench' : slot
}

export function groupedMoveDestinations<T extends { positions: string[] }>(
  roster: RosterSlotFill<T>[],
  fromIndex: number,
): { toIndex: number; slot: MockDraftSlot; label: string }[] {
  const seen = new Set<MockDraftSlot>()
  const groups: { toIndex: number; slot: MockDraftSlot; label: string }[] = []
  for (const i of openEligibleSlotIndexes(roster, fromIndex)) {
    const slot = roster[i].slot
    if (seen.has(slot)) continue
    seen.add(slot)
    groups.push({ toIndex: i, slot, label: moveSlotLabel(slot) })
  }
  return groups
}

export function openEligibleSlotIndexes<T extends { positions: string[] }>(
  roster: RosterSlotFill<T>[],
  fromIndex: number,
): number[] {
  const player = roster[fromIndex]?.player
  if (!player) return []
  return roster.flatMap((row, i) =>
    i !== fromIndex && !row.player && playerFitsSlot(player.positions, row.slot) ? [i] : [],
  )
}

export function moveRosterPlayer<T extends { positions: string[] }>(
  roster: RosterSlotFill<T>[],
  fromIndex: number,
  toIndex: number,
): RosterSlotFill<T>[] {
  const player = roster[fromIndex]?.player
  const dest = roster[toIndex]
  if (!player || !dest || dest.player || !playerFitsSlot(player.positions, dest.slot)) return roster
  return roster.map((row, i) => {
    if (i === fromIndex) return { ...row, player: null }
    if (i === toIndex) return { ...row, player }
    return row
  })
}

export function eligibleForPhase<T extends { positions: string[] }>(
  roster: RosterSlotFill<unknown>[],
  available: T[],
): T[] {
  const holes = emptySlotsInPhase(roster, rosterPhase(roster))
  if (!holes.length) return available
  const fitted = available.filter((p) => holes.some((s) => playerFitsSlot(p.positions, s.slot)))
  return fitted.length ? fitted : available
}

export type BotPickWindow = {
  /** Rolls below this take the best eligible player. */
  bpaRate: number
  /** Rolls below this, and at or above bpaRate, take the short reach. */
  nearRate: number
  nearReach: number
  longReach: number
}

/** Round 1 matches the old 80/15/5. The last round of a 15-round mock is much looser. */
const EARLY_BOT_WINDOW = { bpaRate: 0.8, nearShare: 0.15, nearReach: 2, longReach: 5 }
const LATE_BOT_WINDOW = { bpaRate: 0.35, nearShare: 0.3, nearReach: 8, longReach: 18 }
/** Below 1 so a 15-round draft is already loose by the middle, not only in round 15. */
const BOT_LOOSEN_CURVE = 0.65
const FIFTEEN_ROUND_SPAN = 14

/** Long-reach targets on a 15-round mock: round 5 reaches 9, round 8 reaches 11. */
const LONG_REACH_ANCHORS: readonly [number, number][] = [
  [0, EARLY_BOT_WINDOW.longReach],
  [Math.pow(4 / FIFTEEN_ROUND_SPAN, BOT_LOOSEN_CURVE), 9],
  [Math.pow(0.5, BOT_LOOSEN_CURVE), 11],
  [1, LATE_BOT_WINDOW.longReach],
]

function longReachForProgress(progress: number): number {
  for (let i = 1; i < LONG_REACH_ANCHORS.length; i++) {
    const [endProgress, endReach] = LONG_REACH_ANCHORS[i]
    const [startProgress, startReach] = LONG_REACH_ANCHORS[i - 1]
    if (progress <= endProgress) {
      const span = endProgress - startProgress
      const t = span === 0 ? 1 : (progress - startProgress) / span
      return Math.round(startReach + (endReach - startReach) * t)
    }
  }
  return LATE_BOT_WINDOW.longReach
}

export function botWindowForRound(round: number, rounds: number): BotPickWindow {
  const span = Math.max(1, rounds - 1)
  const linear = Math.min(1, Math.max(0, (round - 1) / span))
  const progress = Math.pow(linear, BOT_LOOSEN_CURVE)
  const mix = (start: number, end: number) => start + (end - start) * progress
  const bpaRate = mix(EARLY_BOT_WINDOW.bpaRate, LATE_BOT_WINDOW.bpaRate)
  const nearShare = mix(EARLY_BOT_WINDOW.nearShare, LATE_BOT_WINDOW.nearShare)
  return {
    bpaRate,
    nearRate: bpaRate + nearShare,
    nearReach: Math.round(mix(EARLY_BOT_WINDOW.nearReach, LATE_BOT_WINDOW.nearReach)),
    longReach: longReachForProgress(progress),
  }
}

export function chooseFromWindow(
  eligibleCount: number,
  roll: number,
  slotRoll: number,
  window: BotPickWindow = botWindowForRound(1, 1),
): number {
  if (eligibleCount <= 1) return 0
  let lo = 0
  let hi = 0
  if (roll < window.bpaRate) {
    lo = 0
    hi = 0
  } else if (roll < window.nearRate) {
    lo = Math.min(1, eligibleCount - 1)
    hi = Math.min(window.nearReach, eligibleCount - 1)
  } else {
    lo = Math.min(1, eligibleCount - 1)
    hi = Math.min(window.longReach, eligibleCount - 1)
  }
  if (hi <= lo) return lo
  return lo + Math.floor(slotRoll * (hi - lo + 1))
}

export function nextBotPick<T extends { id: string; positions: string[] }>(
  roster: RosterSlotFill<T>[],
  availableDefaultOrder: T[],
  random: () => number = Math.random,
  window: BotPickWindow = botWindowForRound(1, 1),
): T | null {
  if (!availableDefaultOrder.length) return null
  const eligible = eligibleForPhase(roster, availableDefaultOrder)
  const idx = chooseFromWindow(eligible.length, random(), random(), window)
  return eligible[idx] ?? eligible[0] ?? null
}

export type MockSessionPlayer = {
  id: string
  espn_id: number | null
  name: string
  team_abbr: string | null
  positions: string[]
}

export type MockPick = {
  pick: number
  team: number
  round: number
  pickInRound: number
  playerId: string
}

export type MockSession = {
  teams: number
  rounds: number
  threeRr: boolean
  userTeam: number
  botDelaySec: number
  userClockSec: number
  defaultOrder: string[]
  userOrder: string[]
  players: Record<string, MockSessionPlayer>
  picks: MockPick[]
  rosters: Record<number, RosterSlotFill<MockSessionPlayer>[]>
  /** Players the user reserved. Bots skip them; the user can still draft them. */
  untouchableIds: string[]
}

export function createMockSession(input: {
  settings: MockDraftSettings
  defaultOrder: string[]
  userOrder: string[]
  players: MockSessionPlayer[]
}): MockSession {
  const settings = clampMockSettings(input.settings)
  const players: Record<string, MockSessionPlayer> = {}
  for (const player of input.players) players[player.id] = player
  const rosters: Record<number, RosterSlotFill<MockSessionPlayer>[]> = {}
  for (let team = 1; team <= settings.teams; team++) {
    rosters[team] = emptyRoster(settings.rounds)
  }
  return {
    teams: settings.teams,
    rounds: settings.rounds,
    threeRr: settings.threeRr,
    userTeam: settings.userPick,
    botDelaySec: settings.botDelaySec,
    userClockSec: settings.userClockSec,
    defaultOrder: input.defaultOrder.filter((id) => players[id]),
    userOrder: input.userOrder.filter((id) => players[id]),
    players,
    picks: [],
    rosters,
    untouchableIds: [],
  }
}

export function nextPickNumber(session: MockSession): number {
  return session.picks.length + 1
}

export function totalPicks(session: MockSession): number {
  return pickCount(session.teams, session.rounds)
}

export function isMockComplete(session: MockSession): boolean {
  return session.picks.length >= totalPicks(session)
}

export function teamOnTheClock(session: MockSession): number | null {
  if (isMockComplete(session)) return null
  return draftTeamForPick(nextPickNumber(session), session.teams, session.threeRr)
}

export function isUserOnTheClock(session: MockSession): boolean {
  return teamOnTheClock(session) === session.userTeam
}

export function takenIds(session: MockSession): Set<string> {
  return new Set(session.picks.map((p) => p.playerId))
}

export function availableDefaultPlayers(session: MockSession): MockSessionPlayer[] {
  const taken = takenIds(session)
  return session.defaultOrder.map((id) => session.players[id]).filter((p): p is MockSessionPlayer => Boolean(p) && !taken.has(p.id))
}

export function untouchableIdSet(session: MockSession): Set<string> {
  return new Set(session.untouchableIds ?? [])
}

/** Remaining players a bot is allowed to take. Untouchables stay in the pool for the user. */
export function availableBotPlayers(session: MockSession): MockSessionPlayer[] {
  const reserved = untouchableIdSet(session)
  return availableDefaultPlayers(session).filter((player) => !reserved.has(player.id))
}

export function toggleUntouchable(session: MockSession, playerId: string): MockSession {
  if (isMockComplete(session) || !session.players[playerId] || takenIds(session).has(playerId)) return session
  const ids = session.untouchableIds ?? []
  const untouchableIds = ids.includes(playerId) ? ids.filter((id) => id !== playerId) : [...ids, playerId]
  return { ...session, untouchableIds }
}

export function availableUserBoardIds(session: MockSession): string[] {
  const taken = takenIds(session)
  return session.userOrder.filter((id) => session.players[id] && !taken.has(id))
}

export function applyDraftPick(session: MockSession, playerId: string): MockSession {
  if (isMockComplete(session) || takenIds(session).has(playerId)) return session
  const player = session.players[playerId]
  if (!player) return session
  const pick = nextPickNumber(session)
  const team = draftTeamForPick(pick, session.teams, session.threeRr)
  const roster = session.rosters[team] ?? emptyRoster(session.rounds)
  if (team === session.userTeam && !hasOpenSlotFor(roster, player.positions)) return session
  return {
    ...session,
    picks: [
      ...session.picks,
      {
        pick,
        team,
        round: Math.floor((pick - 1) / session.teams) + 1,
        pickInRound: ((pick - 1) % session.teams) + 1,
        playerId,
      },
    ],
    rosters: {
      ...session.rosters,
      [team]: assignToRoster(roster, player),
    },
    untouchableIds: (session.untouchableIds ?? []).filter((id) => id !== playerId),
  }
}

export function moveUserRosterPlayer(session: MockSession, fromIndex: number, toIndex: number): MockSession {
  const roster = session.rosters[session.userTeam]
  if (!roster) return session
  const next = moveRosterPlayer(roster, fromIndex, toIndex)
  if (next === roster) return session
  return { ...session, rosters: { ...session.rosters, [session.userTeam]: next } }
}

export function applyBotPick(session: MockSession, random: () => number = Math.random): MockSession {
  if (isMockComplete(session) || isUserOnTheClock(session)) return session
  const team = teamOnTheClock(session)
  if (team == null) return session
  const pick = nextPickNumber(session)
  const round = Math.floor((pick - 1) / session.teams) + 1
  const player = nextBotPick(
    session.rosters[team] ?? emptyRoster(session.rounds),
    availableBotPlayers(session),
    random,
    botWindowForRound(round, session.rounds),
  )
  if (!player) return session
  return applyDraftPick(session, player.id)
}

export function runBotsUntilUser(session: MockSession, random: () => number = Math.random): MockSession {
  let next = session
  let guard = totalPicks(session) + 1
  while (!isMockComplete(next) && !isUserOnTheClock(next) && guard-- > 0) {
    const after = applyBotPick(next, random)
    if (after.picks.length === next.picks.length) break
    next = after
  }
  return next
}

export function autoUserPick(session: MockSession): MockSession {
  if (!isUserOnTheClock(session)) return session
  const roster = session.rosters[session.userTeam] ?? emptyRoster(session.rounds)
  const fits = (id: string) => {
    const player = session.players[id]
    return Boolean(player && hasOpenSlotFor(roster, player.positions))
  }
  const reserved = untouchableIdSet(session)
  const openDefault = availableDefaultPlayers(session).filter((player) => hasOpenSlotFor(roster, player.positions))
  const id =
    availableUserBoardIds(session).find((boardId) => !reserved.has(boardId) && fits(boardId)) ??
    openDefault.find((player) => !reserved.has(player.id))?.id ??
    availableUserBoardIds(session).find(fits) ??
    openDefault[0]?.id
  if (!id) return session
  return applyDraftPick(session, id)
}

export function teamLabel(team: number, userTeam: number): string {
  return team === userTeam ? 'You' : `Team ${team}`
}

/** Ticker window: a few completed picks plus the next ~14. */
export function tickerPickNumbers(total: number, pickNow: number, done: boolean, windowed: boolean): number[] {
  if (!windowed) return Array.from({ length: total }, (_, i) => i + 1)
  if (done) {
    const start = Math.max(1, total - 15)
    return Array.from({ length: total - start + 1 }, (_, i) => start + i)
  }
  const start = Math.max(1, pickNow - 6)
  const end = Math.min(total, Math.max(pickNow + 14, start + 20))
  return Array.from({ length: end - start + 1 }, (_, i) => start + i)
}

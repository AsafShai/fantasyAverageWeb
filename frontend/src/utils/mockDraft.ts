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

/** 80% BPA, 15% among the next 2, 5% among the next 5. */
export function chooseFromWindow(eligibleCount: number, roll: number, slotRoll: number): number {
  if (eligibleCount <= 1) return 0
  let lo = 0
  let hi = 0
  if (roll < 0.8) {
    lo = 0
    hi = 0
  } else if (roll < 0.95) {
    lo = Math.min(1, eligibleCount - 1)
    hi = Math.min(2, eligibleCount - 1)
  } else {
    lo = Math.min(1, eligibleCount - 1)
    hi = Math.min(5, eligibleCount - 1)
  }
  if (hi <= lo) return lo
  return lo + Math.floor(slotRoll * (hi - lo + 1))
}

export function nextBotPick<T extends { id: string; positions: string[] }>(
  roster: RosterSlotFill<T>[],
  availableDefaultOrder: T[],
  random: () => number = Math.random,
): T | null {
  if (!availableDefaultOrder.length) return null
  const eligible = eligibleForPhase(roster, availableDefaultOrder)
  const idx = chooseFromWindow(eligible.length, random(), random())
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
  const player = nextBotPick(session.rosters[team] ?? emptyRoster(session.rounds), availableDefaultPlayers(session), random)
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
  const id =
    availableUserBoardIds(session).find(fits) ??
    availableDefaultPlayers(session).find((player) => hasOpenSlotFor(roster, player.positions))?.id
  if (!id) return session
  return applyDraftPick(session, id)
}

export function teamLabel(team: number, userTeam: number): string {
  return team === userTeam ? 'You' : `Team ${team}`
}

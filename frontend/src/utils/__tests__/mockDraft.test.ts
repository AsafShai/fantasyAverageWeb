import { describe, expect, it } from 'vitest'
import { draftTeamForPick } from '../adp'
import {
  applyDraftPick,
  assignToRoster,
  autoUserPick,
  buildUserOrder,
  botWindowForRound,
  chooseFromWindow,
  clampMockSettings,
  createMockSession,
  csvHasEnoughPlayers,
  emptyRoster,
  eligibleForPhase,
  groupedMoveDestinations,
  hasOpenSlotFor,
  isUserOnTheClock,
  moveRosterPlayer,
  nextBotPick,
  openEligibleSlotIndexes,
  playerFitsSlot,
  rosterPhase,
  rosterPositionCounts,
  rosterSlots,
  runBotsUntilUser,
  tickerPickNumbers,
  toggleUntouchable,
  type MockSessionPlayer,
} from '../mockDraft'

const p = (id: string, positions: string[]): MockSessionPlayer => ({
  id,
  espn_id: Number(id) || null,
  name: `P${id}`,
  team_abbr: 'DEN',
  positions,
})

describe('clampMockSettings', () => {
  it('uses the same league defaults as the draft board', () => {
    const s = clampMockSettings({})
    expect(s.teams).toBe(12)
    expect(s.rounds).toBe(15)
    expect(s.threeRr).toBe(true)
    expect(s.userPick).toBe(1)
  })

  it('clamps the first-round pick to league size', () => {
    expect(clampMockSettings({ teams: 8, userPick: 99 }).userPick).toBe(8)
    expect(clampMockSettings({ teams: 10, userPick: 0 }).userPick).toBe(1)
  })
})

describe('roster slots', () => {
  it('is starters plus flex, then bench to reach rounds', () => {
    expect(rosterSlots(10)).toEqual(['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL', 'UTIL', 'UTIL'])
    expect(rosterSlots(13).filter((s) => s === 'BE')).toHaveLength(3)
    expect(rosterSlots(15)).toHaveLength(15)
  })

  it('matches guards and forwards into G/F and anyone into UTIL/BE', () => {
    expect(playerFitsSlot(['PG'], 'PG')).toBe(true)
    expect(playerFitsSlot(['PG'], 'SG')).toBe(false)
    expect(playerFitsSlot(['PG', 'SG'], 'G')).toBe(true)
    expect(playerFitsSlot(['SF'], 'F')).toBe(true)
    expect(playerFitsSlot(['C'], 'F')).toBe(false)
    expect(playerFitsSlot(['C'], 'UTIL')).toBe(true)
    expect(playerFitsSlot(['PG'], 'BE')).toBe(true)
  })

  it('assigns greedy first empty fitting slot', () => {
    let roster = emptyRoster<MockSessionPlayer>(10)
    roster = assignToRoster(roster, p('1', ['PG']))
    expect(roster[0]).toMatchObject({ slot: 'PG', player: { id: '1' } })
    roster = assignToRoster(roster, p('2', ['PG']))
    expect(roster[5]).toMatchObject({ slot: 'G', player: { id: '2' } })
  })

  it('blocks a PG when PG, G, UTIL, and bench are full', () => {
    let roster = emptyRoster<MockSessionPlayer>(14)
    for (const id of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) {
      roster = assignToRoster(roster, p(id, ['PG']))
    }
    expect(hasOpenSlotFor(roster, ['PG'])).toBe(false)
    expect(hasOpenSlotFor(roster, ['SG'])).toBe(true)
    expect(hasOpenSlotFor(roster, ['C'])).toBe(true)
  })

  it('moves a multi-position player only into empty eligible slots', () => {
    let roster = emptyRoster<MockSessionPlayer>(10)
    roster = assignToRoster(roster, p('1', ['PG', 'SG']))
    const dests = openEligibleSlotIndexes(roster, 0)
    expect(dests).toContain(1)
    expect(dests).toContain(5)
    expect(dests).not.toContain(2)
    roster = moveRosterPlayer(roster, 0, 1)
    expect(roster[0].player).toBeNull()
    expect(roster[1]).toMatchObject({ slot: 'SG', player: { id: '1' } })
  })

  it('groups UTIL and bench into a single first-empty destination each', () => {
    let roster = emptyRoster<MockSessionPlayer>(15)
    roster = assignToRoster(roster, p('1', ['PG', 'SG']))
    const groups = groupedMoveDestinations(roster, 0)
    expect(groups.map((g) => g.label)).toEqual(['SG', 'G', 'UTIL', 'Bench'])
    expect(groups.find((g) => g.slot === 'UTIL')?.toIndex).toBe(7)
    expect(groups.find((g) => g.slot === 'BE')?.toIndex).toBe(10)
  })

  it('does not overwrite an occupied slot or an ineligible position', () => {
    let roster = emptyRoster<MockSessionPlayer>(10)
    roster = assignToRoster(roster, p('1', ['PG', 'SG']))
    roster = assignToRoster(roster, p('2', ['SG']))
    expect(moveRosterPlayer(roster, 0, 1)[0].player?.id).toBe('1')
    expect(moveRosterPlayer(roster, 0, 2)[0].player?.id).toBe('1')
    expect(moveRosterPlayer(roster, 0, 2)[2].player).toBeNull()
  })
})

describe('bot brain', () => {
  it('fills starting five before G/F/UTIL', () => {
    const roster = emptyRoster<MockSessionPlayer>(13)
    expect(rosterPhase(roster)).toBe('starter')
    const available = [p('c', ['C']), p('g', ['PG']), p('f', ['SF'])]
    const eligible = eligibleForPhase(roster, available)
    expect(eligible.map((x) => x.id).sort()).toEqual(['c', 'f', 'g'])
  })

  it('does not take a second PG while a starter hole remains if a center is available', () => {
    let roster = emptyRoster<MockSessionPlayer>(10)
    roster = assignToRoster(roster, p('1', ['PG']))
    roster = assignToRoster(roster, p('2', ['SG']))
    roster = assignToRoster(roster, p('3', ['SF']))
    roster = assignToRoster(roster, p('4', ['PF']))
    const available = [p('pg2', ['PG']), p('c', ['C'])]
    const pick = nextBotPick(roster, available, () => 0)
    expect(pick?.id).toBe('c')
  })

  it('takes the best player on a low roll and reaches further as the roll rises', () => {
    const roster = emptyRoster<MockSessionPlayer>(10)
    const available = [p('1', ['PG']), p('2', ['SG']), p('3', ['C'])]
    const late = botWindowForRound(15, 15)
    expect(nextBotPick(roster, available, () => 0)?.id).toBe('1')
    expect(chooseFromWindow(20, 0.34, 0, late)).toBe(0)
    expect(chooseFromWindow(20, 0.35, 0, late)).toBe(1)
    expect(chooseFromWindow(20, 0.64, 0.99, late)).toBe(8)
    expect(chooseFromWindow(20, 0.65, 0, late)).toBe(1)
    expect(chooseFromWindow(20, 0.99, 0.99, late)).toBe(18)
  })

  it('loosens across a 15-round mock instead of staying on the best player', () => {
    const early = botWindowForRound(1, 15)
    expect(early.bpaRate).toBeCloseTo(0.8)
    expect(early.nearRate).toBeCloseTo(0.95)
    expect(early.nearReach).toBe(2)
    expect(early.longReach).toBe(5)
    expect(chooseFromWindow(20, 0.79, 0, early)).toBe(0)
    expect(chooseFromWindow(20, 0.8, 0, early)).toBe(1)

    expect(botWindowForRound(5, 15).longReach).toBe(9)

    const mid = botWindowForRound(8, 15)
    expect(mid.bpaRate).toBeCloseTo(0.513, 2)
    expect(mid.bpaRate).toBeLessThan(0.55)
    expect(mid.nearReach).toBe(6)
    expect(mid.longReach).toBe(11)

    expect(botWindowForRound(11, 15).longReach).toBe(14)

    const late = botWindowForRound(15, 15)
    expect(late.bpaRate).toBeCloseTo(0.35)
    expect(late.nearRate).toBeCloseTo(0.65)
    expect(late.nearReach).toBe(8)
    expect(late.longReach).toBe(18)
  })
})

describe('user board vs bots', () => {
  it('appends leftover default ids after a saved or csv prefix', () => {
    expect(buildUserOrder(['a', 'b', 'c'], 'default', ['c'], [])).toEqual(['a', 'b', 'c'])
    expect(buildUserOrder(['a', 'b', 'c'], 'saved', ['c', 'a'], [])).toEqual(['c', 'a', 'b'])
    expect(buildUserOrder(['a', 'b', 'c'], 'csv', [], ['b'])).toEqual(['b', 'a', 'c'])
  })

  it('requires at least as many matched csv players as draft picks', () => {
    expect(csvHasEnoughPlayers(180, 12, 15)).toBe(true)
    expect(csvHasEnoughPlayers(179, 12, 15)).toBe(false)
  })
})

describe('session engine', () => {
  const players = [
    p('1', ['PG']),
    p('2', ['SG']),
    p('3', ['SF']),
    p('4', ['PF']),
    p('5', ['C']),
    p('6', ['PG']),
    p('7', ['SG']),
    p('8', ['SF']),
  ]

  it('puts the user on the clock at their first-round slot, including 3RR later rounds', () => {
    const session = createMockSession({
      settings: {
        teams: 8,
        rounds: 10,
        threeRr: true,
        userPick: 3,
        botDelaySec: 0,
        userClockSec: 0,
        rankingSource: 'default',
      },
      defaultOrder: players.map((x) => x.id),
      userOrder: players.map((x) => x.id),
      players,
    })
    expect(draftTeamForPick(1, 8, true)).toBe(1)
    expect(draftTeamForPick(3, 8, true)).toBe(3)
    const afterBots = runBotsUntilUser(session, () => 0)
    expect(isUserOnTheClock(afterBots)).toBe(true)
    expect(afterBots.picks).toHaveLength(2)
    expect(afterBots.picks.map((pk) => pk.team)).toEqual([1, 2])
  })

  it('skips players the user marked untouchable and still lets the user draft them', () => {
    let session = createMockSession({
      settings: clampMockSettings({ teams: 4, rounds: 2, userPick: 4 }),
      defaultOrder: players.map((x) => x.id),
      userOrder: players.map((x) => x.id),
      players,
    })
    session = toggleUntouchable(session, '1')
    session = toggleUntouchable(session, '2')
    const afterBots = runBotsUntilUser(session, () => 0)
    expect(afterBots.picks.map((pk) => pk.playerId)).toEqual(['3', '4', '5'])
    expect(isUserOnTheClock(afterBots)).toBe(true)
    const userPick = applyDraftPick(afterBots, '1')
    expect(userPick.picks.at(-1)?.playerId).toBe('1')
    expect(userPick.untouchableIds).toEqual(['2'])
    expect(toggleUntouchable(userPick, '2').untouchableIds).toEqual([])
  })

  it('auto-picks past an untouchable when another board player still fits', () => {
    let session = createMockSession({
      settings: {
        teams: 8,
        rounds: 10,
        threeRr: false,
        userPick: 1,
        botDelaySec: 0,
        userClockSec: 30,
        rankingSource: 'csv',
      },
      defaultOrder: ['1', '2', '3', '4', '5', '6', '7', '8'],
      userOrder: ['1', '2', '3', '4', '5', '6', '7', '8'],
      players,
    })
    session = toggleUntouchable(session, '1')
    session = autoUserPick(session)
    expect(session.picks[0]?.playerId).toBe('2')
    expect(session.untouchableIds).toEqual(['1'])
  })

  it('auto-picks the best remaining player on the user board', () => {
    let session = createMockSession({
      settings: {
        teams: 8,
        rounds: 10,
        threeRr: false,
        userPick: 1,
        botDelaySec: 0,
        userClockSec: 30,
        rankingSource: 'csv',
      },
      defaultOrder: ['1', '2', '3', '4', '5', '6', '7', '8'],
      userOrder: ['5', '1', '2', '3', '4', '6', '7', '8'],
      players,
    })
    session = autoUserPick(session)
    expect(session.picks[0]?.playerId).toBe('5')
  })

  it('ignores a second draft of the same player', () => {
    let session = createMockSession({
      settings: clampMockSettings({ teams: 8, rounds: 10, userPick: 1 }),
      defaultOrder: players.map((x) => x.id),
      userOrder: players.map((x) => x.id),
      players,
    })
    session = applyDraftPick(session, '1')
    const again = applyDraftPick(session, '1')
    expect(again.picks).toHaveLength(1)
  })

  it('rejects a user pick that has no open roster slot', () => {
    const fillers = Array.from({ length: 9 }, (_, i) => p(`fill${i}`, ['PG']))
    const leftover = p('c2', ['C'])
    const blockedPg = p('pgx', ['PG'])
    const all = [...players, ...fillers, leftover, blockedPg]
    let session = createMockSession({
      settings: clampMockSettings({ teams: 2, rounds: 14, userPick: 1 }),
      defaultOrder: all.map((x) => x.id),
      userOrder: all.map((x) => x.id),
      players: all,
    })
    let roster = session.rosters[1]
    for (const filler of fillers) roster = assignToRoster(roster, filler)
    session = { ...session, rosters: { ...session.rosters, 1: roster } }
    expect(hasOpenSlotFor(session.rosters[1], ['PG'])).toBe(false)
    const blocked = applyDraftPick(session, blockedPg.id)
    expect(blocked.picks).toHaveLength(0)
    const allowed = applyDraftPick(session, leftover.id)
    expect(allowed.picks[0]?.playerId).toBe(leftover.id)
  })

  it('auto-picks the next board player who still fits a roster hole', () => {
    const fillers = Array.from({ length: 9 }, (_, i) => p(`fill${i}`, ['PG']))
    const leftover = p('c2', ['C'])
    const blockedPg = p('pgx', ['PG'])
    const all = [...players, ...fillers, leftover, blockedPg]
    let session = createMockSession({
      settings: clampMockSettings({ teams: 2, rounds: 14, userPick: 1, userClockSec: 30 }),
      defaultOrder: all.map((x) => x.id),
      userOrder: [blockedPg.id, leftover.id, '2'],
      players: all,
    })
    let roster = session.rosters[1]
    for (const filler of fillers) roster = assignToRoster(roster, filler)
    session = { ...session, rosters: { ...session.rosters, 1: roster } }
    session = autoUserPick(session)
    expect(session.picks[0]?.playerId).toBe(leftover.id)
  })
})

describe('tickerPickNumbers', () => {
  it('returns every pick when the ticker is not windowed', () => {
    expect(tickerPickNumbers(182, 40, false, false)).toHaveLength(182)
  })

  it('keeps a short window around the current pick', () => {
    expect(tickerPickNumbers(182, 40, false, true)).toEqual(
      Array.from({ length: 21 }, (_, i) => 34 + i),
    )
  })

  it('shows the last picks after the draft ends', () => {
    expect(tickerPickNumbers(182, 182, true, true)).toEqual(
      Array.from({ length: 16 }, (_, i) => 167 + i),
    )
  })
})

describe('rosterPositionCounts', () => {
  const fill = (positions: string[][]) =>
    positions.map((p, i) => ({ slot: 'BE' as const, player: { id: String(i), positions: p } }))

  it('counts secondary positions for every position a player lists', () => {
    const counts = rosterPositionCounts([
      ...fill([['PG'], ['SG', 'SF'], ['PF', 'C']]),
      { slot: 'C' as const, player: null },
    ])
    expect(counts).toEqual({ PG: 1, SG: 1, SF: 1, PF: 1, C: 1 })
  })

  it('returns zeros for an empty roster and ignores unknown positions', () => {
    expect(rosterPositionCounts(fill([['DH']]))).toEqual({ PG: 0, SG: 0, SF: 0, PF: 0, C: 0 })
  })

  it('counts a duplicated position only once per player', () => {
    expect(rosterPositionCounts(fill([['PG', 'pg']])).PG).toBe(1)
  })
})

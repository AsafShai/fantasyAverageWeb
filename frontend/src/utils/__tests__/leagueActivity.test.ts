import { describe, expect, it } from 'vitest'
import type { ActivityMove, PlayerStint, Trade } from '../../types/activity'
import {
  OPEN_SPOT_KEY,
  buildTradeTree,
  categoryValue,
  countedLine,
  filterMoves,
  formatCategory,
  isCounted,
  missedGames,
  orderCategories,
  overridesForTrade,
  resetTrade,
  setCounted,
  sideRows,
  sumStints,
} from '../leagueActivity'

function stint(id: number, team: number, over: Partial<PlayerStint> = {}): PlayerStint {
  return {
    player_id: id, name: `P${id}`, team_id: team, start: '2026-01-01', end: '2026-01-10', days: 10,
    games_played: 4, team_games: 5, totals: { PTS: 40, REB: 20, FGM: 15, FGA: 30, FTM: 6, FTA: 8 },
    exit: 'season_end', exit_trade_id: null, picked_up_after: null, ...over,
  }
}

function trade(id: string, date: string, a: [number, PlayerStint[]], b: [number, PlayerStint[]], extra: Partial<Trade> = {}): Trade {
  return {
    id, date, accepted_at: null, released_for_trade: [], open_roster_spot: null,
    sides: [{ team_id: a[0], received: a[1] }, { team_id: b[0], received: b[1] }], ...extra,
  }
}

describe('category values', () => {
  const line = sumStints([stint(1, 1), stint(2, 1, { games_played: 6, totals: { PTS: 60, FGM: 5, FGA: 20 } })])

  it('sums totals and games across stints', () => {
    expect(line.gp).toBe(10)
    expect(line.totals.PTS).toBe(100)
  })

  it('builds percentages from makes and attempts, never averages of percentages', () => {
    expect(categoryValue(line, 'FG%', 'totals')).toBeCloseTo(20 / 50)
    expect(categoryValue(line, 'FG%', 'per_game')).toBeCloseTo(20 / 50)
  })

  it('divides counting stats by games in per-game mode', () => {
    expect(categoryValue(line, 'PTS', 'totals')).toBe(100)
    expect(categoryValue(line, 'PTS', 'per_game')).toBe(10)
    expect(formatCategory(10, 'PTS', 'per_game')).toBe('10.0')
    expect(formatCategory(100, 'PTS', 'totals')).toBe('100')
  })

  it('shows a dash when there is nothing to compute', () => {
    const empty = sumStints([])
    expect(categoryValue(empty, 'FT%', 'totals')).toBeNull()
    expect(categoryValue(empty, 'PTS', 'per_game')).toBeNull()
    expect(formatCategory(null, 'PTS', 'totals')).toBe('–')
  })

  it('orders league categories the way the app shows them', () => {
    expect(orderCategories(['PTS', 'BLK', 'STL', 'AST', 'REB', '3PM', 'FG%', 'FT%'])).toEqual([
      'FG%', 'FT%', '3PM', 'REB', 'AST', 'STL', 'BLK', 'PTS',
    ])
  })

  it('flags missed games against the NBA team schedule', () => {
    expect(missedGames(stint(1, 1, { games_played: 2, team_games: 10 }))).toBe(true)
    expect(missedGames(stint(1, 1, { games_played: 9, team_games: 10 }))).toBe(false)
  })
})

describe('per-viewer overrides', () => {
  const t = trade('t1', '2026-03-17', [1, [stint(10, 1), stint(11, 1)]], [8, [stint(20, 8)]], {
    open_roster_spot: { team_id: 8, added_on: '2026-03-17', stint: stint(30, 8, { games_played: 1 }) },
  })

  it('counts traded players and leaves the open-spot pickup out by default', () => {
    expect(sideRows(t, 1, {}).map(r => r.counted)).toEqual([true, true])
    const dor = sideRows(t, 8, {})
    expect(dor.map(r => [r.stint.player_id, r.openSpot, r.counted])).toEqual([[20, false, true], [30, true, false]])
    expect(countedLine(dor).gp).toBe(4)
  })

  it('applies and resets the viewer choices, storing only departures from the default', () => {
    let o = setCounted({}, 't1', 11, false)
    o = setCounted(o, 't1', OPEN_SPOT_KEY, true)
    expect(isCounted(o, 't1', 11)).toBe(false)
    expect(countedLine(sideRows(t, 1, o)).gp).toBe(4)
    expect(countedLine(sideRows(t, 8, o)).gp).toBe(5)
    expect(overridesForTrade(o, 't1')).toBe(2)

    expect(setCounted(o, 't1', 11, true)).not.toHaveProperty('t1:11')
    expect(resetTrade({ ...o, 't2:5': false }, 't1')).toEqual({ 't2:5': false })
  })
})

describe('trade tree', () => {
  // Team 1 gets P10 in t1, flips him in t2 for P11, flips P11 in t3 for P12.
  const trades = [
    trade('t1', '2026-01-01', [1, [stint(10, 1, { exit: 'traded', exit_trade_id: 't2' })]], [2, [stint(90, 2)]]),
    trade('t2', '2026-01-10', [1, [stint(11, 1, { exit: 'traded', exit_trade_id: 't3' })]], [3, [stint(10, 3), stint(91, 3)]]),
    trade('t3', '2026-01-20', [4, [stint(11, 4)]], [1, [stint(12, 1, { exit: 'released' })]]),
  ]

  it('follows what one side turned into, with what was sent alongside', () => {
    const tree = buildTradeTree(trades, 't1', 1, 5)
    const first = tree.root[0]
    expect(first.stint.player_id).toBe(10)
    expect(first.next?.otherTeamId).toBe(3)
    expect(first.next?.sentAlongside.map(s => s.player_id)).toEqual([91])
    const second = first.next?.received[0]
    expect(second?.stint.player_id).toBe(11)
    expect(second?.next?.received[0].stint.player_id).toBe(12)
    expect(second?.next?.received[0].next).toBeNull()
    expect(tree.stints).toBe(3)
    expect(tree.truncated.size).toBe(0)
  })

  it('stops at the depth limit and says where', () => {
    const tree = buildTradeTree(trades, 't1', 1, 1)
    expect(tree.root[0].next?.received).toEqual([])
    expect([...tree.truncated]).toEqual(['t2'])
  })

  it('shows a follow-up trade that took two of the team\'s players once', () => {
    // Team 1 gets P10 and P11, then sends both in t2 for P20 and P21.
    const pair = [
      trade('t1', '2026-01-01', [1, [
        stint(10, 1, { exit: 'traded', exit_trade_id: 't2' }),
        stint(11, 1, { exit: 'traded', exit_trade_id: 't2' }),
      ]], [2, [stint(90, 2)]]),
      trade('t2', '2026-01-10', [1, [stint(20, 1), stint(21, 1)]], [3, [stint(10, 3), stint(11, 3)]]),
    ]
    const tree = buildTradeTree(pair, 't1', 1, 5)
    const [first, second] = tree.root
    expect(first.next?.shownWith).toBeNull()
    expect(first.next?.received.map(r => r.stint.player_id)).toEqual([20, 21])
    expect(second.next?.shownWith).toBe('P10')
    expect(second.next?.received).toEqual([])
    expect(tree.stints).toBe(4) // P10, P11, P20, P21: the return is counted once
    expect(tree.games).toBe(16)
  })

  it('never loops on a cycle', () => {
    const loop = [
      trade('a', '2026-01-01', [1, [stint(10, 1, { exit: 'traded', exit_trade_id: 'b' })]], [2, []]),
      trade('b', '2026-01-02', [2, []], [1, [stint(11, 1, { exit: 'traded', exit_trade_id: 'a' })]]),
    ]
    expect(buildTradeTree(loop, 'a', 1, 50).stints).toBe(2)
  })
})

describe('feed filters', () => {
  const move = (id: string, kind: ActivityMove['kind'], team: number, at: string, other: number | null = null): ActivityMove => ({
    id, kind, at, team_id: team, other_team_id: other, trade_id: null, added: [], dropped: [],
  })
  const moves = [
    move('a', 'add', 1, '2026-03-10T12:00:00Z'),
    move('b', 'trade_drop', 2, '2026-03-11T12:00:00Z'),
    move('c', 'trade', 3, '2026-03-12T12:00:00Z', 1),
    move('d', 'waiver', 2, '2026-03-20T12:00:00Z'),
  ]

  it('filters by team on either side of a trade', () => {
    expect(filterMoves(moves, { teamId: 1, kind: 'all', from: '', to: '' }).map(m => m.id)).toEqual(['a', 'c'])
  })

  it('treats trade-forced releases as drops', () => {
    expect(filterMoves(moves, { teamId: null, kind: 'drop', from: '', to: '' }).map(m => m.id)).toEqual(['b'])
  })

  it('filters by an inclusive date range', () => {
    expect(filterMoves(moves, { teamId: null, kind: 'all', from: '2026-03-11', to: '2026-03-12' }).map(m => m.id)).toEqual(['b', 'c'])
  })
})

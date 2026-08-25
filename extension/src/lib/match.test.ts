import { describe, expect, it } from 'vitest'
import { csvSlot, findPlayerIndex, mergeEspnOrder, packedPlacement, topPlayers } from './match'
import type { EspnBoardRow, RankedPlayer } from './types'

function desired(rows: Array<[number, number | null, string, string]>): RankedPlayer[] {
  return rows.map(([rank, espnId, name, team]) => ({ rank, espnId, name, team }))
}

function board(rows: Array<[number | null, string, string]>): EspnBoardRow[] {
  return rows.map(([espnId, name, team], index) => ({ espnId, name, team, index }))
}

describe('topPlayers', () => {
  it('keeps only the first 300 by csv rank', () => {
    const players = desired(
      Array.from({ length: 350 }, (_, i) => [i + 1, i + 1, `P${i + 1}`, 'DEN'] as [number, number, string, string]),
    )
    const top = topPlayers(players)
    expect(top).toHaveLength(300)
    expect(top[0].rank).toBe(1)
    expect(top[299].rank).toBe(300)
  })
})

describe('findPlayerIndex', () => {
  it('finds a player without caring about the rest of the board', () => {
    const rows = board([
      [1, 'A', 'LAL'],
      [2, 'B', 'BOS'],
      [3, 'C', 'DEN'],
    ])
    expect(findPlayerIndex({ rank: 1, espnId: 3, name: 'C', team: 'DEN' }, rows)).toBe(2)
    expect(csvSlot({ rank: 17, espnId: 3, name: 'C', team: 'DEN' })).toBe(16)
  })
})

describe('mergeEspnOrder', () => {
  it('orders by espn id and appends unmatched ESPN rows', () => {
    const result = mergeEspnOrder(
      desired([
        [1, 3, 'C', 'DEN'],
        [2, 1, 'A', 'LAL'],
      ]),
      board([
        [1, 'A', 'LAL'],
        [2, 'B', 'BOS'],
        [3, 'C', 'DEN'],
      ]),
    )
    expect(result.matched).toBe(2)
    expect(result.next.map((r) => r.espnId)).toEqual([3, 1, 2])
    expect(result.unmatchedEspn.map((r) => r.espnId)).toEqual([2])
    expect(result.unmatchedCsv).toEqual([])
  })

  it('falls back to name and team aliases', () => {
    const result = mergeEspnOrder(
      desired([[1, null, 'Stephen Curry', 'GSW']]),
      board([[3975, 'Stephen Curry', 'GS']]),
    )
    expect(result.matched).toBe(1)
    expect(result.next[0].espnId).toBe(3975)
  })

  it('matches names that differ only by diacritics', () => {
    const result = mergeEspnOrder(
      desired([[1, null, 'Nikola Jokic', 'DEN']]),
      board([[3112335, 'Nikola Jokić', 'DEN']]),
    )
    expect(result.matched).toBe(1)
  })

  it('does not guess when the same name appears twice', () => {
    const result = mergeEspnOrder(
      desired([[1, null, 'Tim Smith', 'DEN']]),
      board([
        [1, 'Tim Smith', 'LAL'],
        [2, 'Tim Smith', 'BOS'],
      ]),
    )
    expect(result.matched).toBe(0)
    expect(result.unmatchedCsv).toHaveLength(1)
    expect(result.next.map((r) => r.espnId)).toEqual([1, 2])
  })

  it('does not match a unique name when the team disagrees', () => {
    const result = mergeEspnOrder(
      desired([[1, null, 'Tim Smith', 'DEN']]),
      board([[1, 'Tim Smith', 'LAL']]),
    )
    expect(result.matched).toBe(0)
    expect(result.unmatchedCsv).toHaveLength(1)
  })

  it('lists csv players that are not on the ESPN board', () => {
    const result = mergeEspnOrder(
      desired([
        [1, 1, 'A', 'LAL'],
        [2, 99, 'Ghost', 'FA'],
      ]),
      board([[1, 'A', 'LAL']]),
    )
    expect(result.unmatchedCsv.map((p) => p.name)).toEqual(['Ghost'])
    expect(result.next.map((r) => r.espnId)).toEqual([1])
  })

  it('packs the next csv player into the hole when ESPN is missing a rank', () => {
    const want = desired([
      [1, 1, 'A', 'LAL'],
      [2, 99, 'Ghost', 'FA'],
      [3, 3, 'C', 'DEN'],
    ])
    const espn = board([
      [1, 'A', 'LAL'],
      [2, 'B', 'BOS'],
      [3, 'C', 'DEN'],
    ])
    const result = mergeEspnOrder(want, espn)
    expect(result.next.map((r) => r.espnId)).toEqual([1, 3, 2])
    expect(packedPlacement(want, espn)).toEqual({ placed: 1, missing: 1, wrong: 1 })
    const packed = board([
      [1, 'A', 'LAL'],
      [3, 'C', 'DEN'],
      [2, 'B', 'BOS'],
    ])
    expect(packedPlacement(want, packed)).toEqual({ placed: 2, missing: 1, wrong: 0 })
  })
})

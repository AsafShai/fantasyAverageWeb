import { describe, it, expect } from 'vitest'
import { computePlayerRankings, partitionByDataAvailability, CATEGORIES } from '../playerRankings'
import type { Player } from '../../types/api'
import type { RankingsConfig } from '../playerRankings'

function makePlayer(overrides: {
  name?: string
  pts?: number
  reb?: number
  ast?: number
  stl?: number
  blk?: number
  three_pm?: number
  fg_percentage?: number
  ft_percentage?: number
  gp?: number
  minutes?: number
  positions?: string[]
}): Player {
  return {
    player_name: overrides.name ?? 'Player',
    pro_team: 'LAL',
    positions: overrides.positions ?? ['PG'],
    stats: {
      pts: overrides.pts ?? 20,
      reb: overrides.reb ?? 5,
      ast: overrides.ast ?? 5,
      stl: overrides.stl ?? 1,
      blk: overrides.blk ?? 0.5,
      three_pm: overrides.three_pm ?? 2,
      fg_percentage: overrides.fg_percentage ?? 0.47,
      ft_percentage: overrides.ft_percentage ?? 0.85,
      fgm: 8, fga: 17, ftm: 4, fta: 5,
      minutes: overrides.minutes ?? 30,
      gp: overrides.gp ?? 70,
    },
    team_id: 1,
    status: 'ONTEAM',
  }
}

const defaultWeights = Object.fromEntries(CATEGORIES.map(c => [c, 1])) as Record<typeof CATEGORIES[number], number>

const defaultConfig: RankingsConfig = {
  calcMode: 'per_game',
  minGp: 0,
  minMin: 0,
  position: null,
  weights: defaultWeights,
}

function makePlayers(n: number): Player[] {
  return Array.from({ length: n }, (_, i) =>
    makePlayer({ name: `P${i}`, pts: i + 1, gp: 70 })
  )
}

describe('computePlayerRankings', () => {
  it('caps at 300 (two-pass reference pool) with a large pool — display limit is applied by the caller, not here', () => {
    const players = makePlayers(400)
    const result = computePlayerRankings(players, defaultConfig)
    expect(result.length).toBe(300)
  })

  it('returns all players when pool < 300', () => {
    const players = makePlayers(10)
    const result = computePlayerRankings(players, defaultConfig)
    expect(result.length).toBe(10)
  })

  it('sorts by totalZ descending', () => {
    const players = [
      makePlayer({ name: 'Low', pts: 5 }),
      makePlayer({ name: 'High', pts: 40 }),
      makePlayer({ name: 'Mid', pts: 20 }),
    ]
    const result = computePlayerRankings(players, defaultConfig)
    expect(result[0].player.player_name).toBe('High')
    expect(result[result.length - 1].player.player_name).toBe('Low')
  })

  it('minGp filter excludes low-GP players', () => {
    const players = [
      makePlayer({ name: 'Active', gp: 60 }),
      makePlayer({ name: 'Injured', gp: 5 }),
    ]
    const result = computePlayerRankings(players, { ...defaultConfig, minGp: 20 })
    expect(result.some(r => r.player.player_name === 'Injured')).toBe(false)
    expect(result.some(r => r.player.player_name === 'Active')).toBe(true)
  })

  it('minMin filter excludes low-minutes players', () => {
    const players = [
      makePlayer({ name: 'Starter', minutes: 30 }),
      makePlayer({ name: 'GLeague', minutes: 5 }),
    ]
    const result = computePlayerRankings(players, { ...defaultConfig, minMin: 15 })
    expect(result.some(r => r.player.player_name === 'GLeague')).toBe(false)
  })

  it('position filter excludes players not at that position', () => {
    const players = [
      makePlayer({ name: 'Guard', positions: ['PG', 'SG'] }),
      makePlayer({ name: 'Big', positions: ['PF', 'C'] }),
    ]
    const result = computePlayerRankings(players, { ...defaultConfig, position: 'PG' })
    expect(result.some(r => r.player.player_name === 'Big')).toBe(false)
    expect(result.some(r => r.player.player_name === 'Guard')).toBe(true)
  })

  it('punted category (weight=0) contributes 0 to totalZ', () => {
    const players = [
      makePlayer({ name: 'A', pts: 40, ast: 1 }),
      makePlayer({ name: 'B', pts: 5, ast: 20 }),
    ]
    const puntPts = { ...defaultWeights, pts: 0 }
    const result = computePlayerRankings(players, { ...defaultConfig, weights: puntPts })
    expect(result[0].player.player_name).toBe('B')
    expect(result[0].zScores.pts).toBeDefined()
  })

  it('per_game mode divides counting stats by GP', () => {
    const players = [
      makePlayer({ name: 'HighVolume', pts: 2000, gp: 100 }),
      makePlayer({ name: 'LowGames', pts: 600, gp: 20 }),
    ]
    const perGameResult = computePlayerRankings(players, { ...defaultConfig, calcMode: 'per_game' })
    const totalsResult = computePlayerRankings(players, { ...defaultConfig, calcMode: 'totals' })
    expect(perGameResult[0].player.player_name).toBe('LowGames')
    expect(totalsResult[0].player.player_name).toBe('HighVolume')
  })

  it('fg_percentage is not divided by GP in per_game mode', () => {
    const players = [
      makePlayer({ name: 'A', fg_percentage: 0.6, gp: 10 }),
      makePlayer({ name: 'B', fg_percentage: 0.4, gp: 80 }),
    ]
    const result = computePlayerRankings(players, { ...defaultConfig, calcMode: 'per_game' })
    expect(result[0].player.player_name).toBe('A')
  })

  it('two-pass: pool >= 300 uses top-300 as second reference', () => {
    const players = makePlayers(350)
    const result = computePlayerRankings(players, defaultConfig)
    expect(result.length).toBe(300)
    expect(result[0].player.player_name).toBe('P349')
  })

  it('single pass when filtered pool < 300', () => {
    const players = makePlayers(50)
    const result = computePlayerRankings(players, defaultConfig)
    expect(result.length).toBe(50)
  })

  it('each player has zScores for all categories', () => {
    const players = makePlayers(5)
    const result = computePlayerRankings(players, defaultConfig)
    for (const ranked of result) {
      for (const cat of CATEGORIES) {
        expect(ranked.zScores[cat]).toBeDefined()
        expect(typeof ranked.zScores[cat]).toBe('number')
      }
    }
  })

  it('returns empty array when all players filtered out', () => {
    const players = makePlayers(5)
    const result = computePlayerRankings(players, { ...defaultConfig, minGp: 999 })
    expect(result).toEqual([])
  })
})

describe('partitionByDataAvailability', () => {
  it('separates has_data: false players into excluded', () => {
    const players = [
      makePlayer({ name: 'Available' }),
      { ...makePlayer({ name: 'NoData' }), has_data: false },
      makePlayer({ name: 'AlsoAvailable' }),
    ]
    const { available, excluded } = partitionByDataAvailability(players)
    expect(available.map(p => p.player_name)).toEqual(['Available', 'AlsoAvailable'])
    expect(excluded.map(p => p.player_name)).toEqual(['NoData'])
  })

  it('treats undefined has_data as available (backwards compatible)', () => {
    const players = [makePlayer({ name: 'Legacy' })]
    const { available, excluded } = partitionByDataAvailability(players)
    expect(available).toHaveLength(1)
    expect(excluded).toHaveLength(0)
  })

  it('treats has_data: true explicitly as available', () => {
    const players = [{ ...makePlayer({ name: 'Zeroed' }), has_data: true, stats: { ...makePlayer({}).stats, gp: 0, pts: 0 } }]
    const { available, excluded } = partitionByDataAvailability(players)
    expect(available).toHaveLength(1)
    expect(excluded).toHaveLength(0)
  })

  it('returns empty partitions for an empty input', () => {
    const { available, excluded } = partitionByDataAvailability([])
    expect(available).toEqual([])
    expect(excluded).toEqual([])
  })
})

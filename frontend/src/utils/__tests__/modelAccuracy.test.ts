import { describe, expect, it } from 'vitest'
import type { Player } from '../../types/api'
import type { PlayerAccuracyRow } from '../../types/api'
import { deltaScale, errorDeltaPct, filterByRoster, formatBand, formatError, headline, rankPlayers } from '../modelAccuracy'

const cat = (key: string, model_mae: number | null, baseline_mae: number | null) => ({
  key, label: key.toUpperCase(), band: 1, model_mae, baseline_mae, hit_rate: null, games: 10,
})

describe('modelAccuracy utils', () => {
  it('reports model error relative to the baseline, negative when the model is better', () => {
    expect(errorDeltaPct(cat('pts', 4.5, 5))).toBeCloseTo(-10)
    expect(errorDeltaPct(cat('ft_pct', 15.3, 15))).toBeCloseTo(2)
    expect(errorDeltaPct(cat('pts', null, 5))).toBeNull()
    expect(errorDeltaPct(cat('pts', 1, 0))).toBeNull()
  })

  it('summarizes categories beating the baseline, skipping ungraded ones', () => {
    const h = headline([cat('pts', 4.5, 5), cat('reb', 2, 2.5), cat('ft_pct', 15.3, 15), cat('blk', null, null)])
    expect(h.beating).toBe(2)
    expect(h.graded).toBe(3)
    expect(h.avgReduction).toBeCloseTo((10 + 20 - 2) / 3)
  })

  it('formats percentage categories in points', () => {
    expect(formatBand(10, 'fg_pct')).toBe('±10 pp')
    expect(formatBand(4, 'pts')).toBe('±4')
    expect(formatError(11.42, 'fg_pct')).toBe('11.4')
    expect(formatError(0.931, 'fg3m')).toBe('0.93')
    expect(formatError(null, 'pts')).toBe('—')
  })

  it('filters rows by the current fantasy roster', () => {
    const roster = [
      { player_id: 1, team_id: 3, status: 'ONTEAM' },
      { player_id: 2, team_id: 5, status: 'ONTEAM' },
      { player_id: 3, team_id: 0, status: 'FREEAGENT' },
    ] as Player[]
    const rows = [{ player_id: 1 }, { player_id: 2 }, { player_id: 3 }, { player_id: 4 }]
    expect(filterByRoster(rows, roster, 'mine', 3).map(r => r.player_id)).toEqual([1])
    expect(filterByRoster(rows, roster, 'rostered', 3).map(r => r.player_id)).toEqual([1, 2])
    expect(filterByRoster(rows, roster, 'all', 3)).toHaveLength(4)
    // Roster not loaded yet: show everything rather than an empty table.
    expect(filterByRoster(rows, undefined, 'mine', 3)).toHaveLength(4)
  })

  it('scales the error bars to the data, never tighter than ±5%', () => {
    expect(deltaScale([-2.4, -3.4, 1.6])).toBe(5)
    expect(deltaScale([-13.8, 2])).toBe(15)
    expect(deltaScale([null])).toBe(5)
  })

  it('ranks flagged players first, then by size of average miss', () => {
    const row = (player_id: number, flag: PlayerAccuracyRow['flag'], zs: number[]) =>
      ({ player_id, flag, games: zs.map(z => ({ z })) }) as unknown as PlayerAccuracyRow
    const ranked = rankPlayers([row(1, 'flat', [0.4]), row(2, 'flat', [-0.9]), row(3, 'up', [0.6]), row(4, 'down', [-1.2])])
    expect(ranked.map(r => r.player_id)).toEqual([4, 3, 2, 1])
  })
})

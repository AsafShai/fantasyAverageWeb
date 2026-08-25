import { describe, expect, it } from 'vitest'
import { parseRankingsCsv } from './parseCsv'

function csv(rows: string[][]): string {
  return rows.map((row) => row.join(',')).join('\n') + '\n'
}

describe('parseRankingsCsv', () => {
  it('reads a site export and uses numeric id as espn id', () => {
    const text = csv([
      ['rank', 'id', 'name', 'team', 'positions'],
      ['2', '3975', 'Nikola Jokic', 'DEN', 'C'],
      ['1', '1966', 'LeBron James', 'LAL', 'SF'],
    ])
    const result = parseRankingsCsv(text)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.players.map((p) => p.espnId)).toEqual([1966, 3975])
    expect(result.players[0].name).toBe('LeBron James')
  })

  it('prefers the optional espn_id column when id is a name key', () => {
    const text = csv([
      ['rank', 'id', 'name', 'team', 'positions', 'espn_id'],
      ['1', 'name:nikolajokic', 'Nikola Jokic', 'DEN', 'C', '3112335'],
    ])
    const result = parseRankingsCsv(text)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.players[0].espnId).toBe(3112335)
  })

  it('keeps name-only rows with a null espn id', () => {
    const text = csv([
      ['rank', 'id', 'name', 'team', 'positions'],
      ['1', 'name:hidden', 'Hidden Player', 'DEN', 'C'],
    ])
    const result = parseRankingsCsv(text)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.players[0].espnId).toBeNull()
    expect(result.players[0].name).toBe('Hidden Player')
  })

  it('rejects a non-rankings header', () => {
    const result = parseRankingsCsv(csv([['blend_rank', 'name'], ['1', 'A']]))
    expect(result.ok).toBe(false)
  })
})

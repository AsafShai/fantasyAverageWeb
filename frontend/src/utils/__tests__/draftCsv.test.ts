import { describe, expect, it } from 'vitest'
import {
  parseRankingsCsvImport,
  rankingsCsvFileError,
  RANKINGS_CSV_HEADERS,
  toCsv,
} from '../draftCsv'

const players = [
  { id: '1', name: 'Alpha' },
  { id: '2', name: 'Bravo' },
  { id: '3', name: 'Charlie' },
  { id: '4', name: 'Delta' },
  { id: '5', name: 'Echo' },
  { id: '6', name: 'Foxtrot' },
  { id: '7', name: 'Golf' },
  { id: '8', name: 'Hotel' },
  { id: '9', name: 'India' },
  { id: '10', name: 'Juliet' },
]

function rankingsCsv(rows: string[][]): string {
  return toCsv([ [...RANKINGS_CSV_HEADERS], ...rows ])
}

function fullBoardCsv(order = players.map((p) => p.id)): string {
  return rankingsCsv(order.map((id, i) => {
    const p = players.find((row) => row.id === id)!
    return [String(i + 1), p.id, p.name, 'DEN', 'PG']
  }))
}

describe('rankings CSV import', () => {
  it('accepts a file we exported and keeps our order', () => {
    const result = parseRankingsCsvImport(fullBoardCsv(['3', '1', '2', '4', '5', '6', '7', '8', '9', '10']), players)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.order.slice(0, 3)).toEqual(['3', '1', '2'])
  })

  it('rejects an ADP-style header', () => {
    const csv = toCsv([
      ['blend_rank', 'name', 'team', 'positions', 'blend', 'spread'],
      ['1', 'Alpha', 'DEN', 'PG', '1.2', '0'],
    ])
    const result = parseRankingsCsvImport(csv, players)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Pre-Draft Rankings export/)
  })

  it('rejects a random CSV', () => {
    const result = parseRankingsCsvImport(toCsv([['foo', 'bar'], ['1', '2']]), players)
    expect(result.ok).toBe(false)
  })

  it('rejects a header with no rows', () => {
    const result = parseRankingsCsvImport(toCsv([[...RANKINGS_CSV_HEADERS]]), players)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/no player rows/)
  })

  it('rejects a bad rank cell', () => {
    const csv = fullBoardCsv().replace('\n1,1,Alpha', '\nnope,1,Alpha')
    const result = parseRankingsCsvImport(csv, players)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/rank/)
  })

  it('rejects when most ids are unknown', () => {
    const rows = players.map((p, i) => [String(i + 1), `missing-${p.id}`, p.name, 'DEN', 'PG'])
    const result = parseRankingsCsvImport(rankingsCsv(rows), players)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/None of the player ids|Too many unknown/)
  })

  it('rejects when more than 20% of ids are unknown', () => {
    const rows = [
      ...players.map((p, i) => [String(i + 1), p.id, p.name, 'DEN', 'PG']),
      ['11', 'x1', 'Nope', 'DEN', 'PG'],
      ['12', 'x2', 'Nope', 'DEN', 'PG'],
      ['13', 'x3', 'Nope', 'DEN', 'PG'],
    ]
    const result = parseRankingsCsvImport(rankingsCsv(rows), players)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Too many unknown/)
  })

  it('rejects a non-csv filename', () => {
    expect(rankingsCsvFileError(new File(['rank,id'], 'notes.txt'))).toMatch(/\.csv/)
  })

  it('appends board players that were missing from a valid export', () => {
    const subset = players.slice(0, 10)
    const csv = rankingsCsv(subset.map((p, i) => [String(i + 1), p.id, p.name, 'DEN', 'C']))
    const extra = [...subset, { id: '99', name: 'New' }]
    const result = parseRankingsCsvImport(csv, extra)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.order.at(-1)).toBe('99')
  })
})

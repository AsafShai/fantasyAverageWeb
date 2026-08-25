export const RANKINGS_CSV_HEADERS = ['rank', 'id', 'name', 'team', 'positions'] as const

export type CsvParseResult =
  | { ok: true; players: import('./types').RankedPlayer[] }
  | { ok: false; error: string }

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  const src = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cell += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n') {
      row.push(cell)
      if (row.some((c) => c.trim() !== '')) rows.push(row)
      row = []
      cell = ''
    } else if (ch !== '\r') {
      cell += ch
    }
  }
  row.push(cell)
  if (row.some((c) => c.trim() !== '')) rows.push(row)
  return rows
}

function headerIndex(header: string[], name: string): number {
  const lower = header.map((h) => h.trim().toLowerCase())
  return lower.indexOf(name.toLowerCase())
}

function isRankingsHeader(header: string[]): boolean {
  if (header.length < RANKINGS_CSV_HEADERS.length) return false
  return RANKINGS_CSV_HEADERS.every((name, i) => header[i].trim().toLowerCase() === name)
}

export function parseRankingsCsv(text: string): CsvParseResult {
  const rows = parseCsvRows(text)
  if (rows.length === 0) return { ok: false, error: 'That file is empty.' }
  if (!isRankingsHeader(rows[0])) {
    return { ok: false, error: 'That file is not a Pre-Draft Rankings export.' }
  }
  const header = rows[0]
  const espnCol = headerIndex(header, 'espn_id')
  const data = rows.slice(1)
  if (data.length === 0) return { ok: false, error: 'That CSV has a header but no player rows.' }
  if (data.length > 2500) return { ok: false, error: 'That CSV has too many rows.' }

  const players: import('./types').RankedPlayer[] = []
  const seen = new Set<string>()
  for (let i = 0; i < data.length; i++) {
    const row = data[i]
    const rank = Number(row[0]?.trim())
    const id = row[1]?.trim() ?? ''
    const name = row[2]?.trim() ?? ''
    const team = row[3]?.trim() ?? ''
    const espnRaw = espnCol >= 0 ? row[espnCol]?.trim() ?? '' : ''
    if (!Number.isInteger(rank) || rank < 1) {
      return { ok: false, error: `Row ${i + 2} has an invalid rank.` }
    }
    if (!id || !name) {
      return { ok: false, error: `Row ${i + 2} is missing an id or name.` }
    }
    if (seen.has(id)) continue
    seen.add(id)
    const espnId = (() => {
      if (/^\d+$/.test(espnRaw)) return Number(espnRaw)
      if (/^\d+$/.test(id)) return Number(id)
      return null
    })()
    players.push({ rank, espnId, name, team })
  }
  players.sort((a, b) => a.rank - b.rank || (a.espnId ?? 0) - (b.espnId ?? 0) || a.name.localeCompare(b.name))
  return { ok: true, players }
}

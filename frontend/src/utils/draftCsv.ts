import { mergeOrder } from './draftRankings'

export const RANKINGS_CSV_HEADERS = ['rank', 'id', 'name', 'team', 'positions'] as const
const MAX_RANKINGS_CSV_BYTES = 2_000_000
const MAX_RANKINGS_CSV_ROWS = 2500
const MAX_UNMATCHED_RATIO = 0.2

export type RankingsCsvPlayer = { id: string; name: string }

export type RankingsCsvImportResult =
  | { ok: true; order: string[]; matched: number; unknown: string[] }
  | { ok: false; error: string }

function escapeCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCell).join(',')).join('\n') + '\n'
}

export function parseCsv(text: string): string[][] {
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

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function headerIndex(header: string[], ...aliases: string[]): number {
  const lower = header.map((h) => h.trim().toLowerCase())
  for (const alias of aliases) {
    const i = lower.indexOf(alias.toLowerCase())
    if (i >= 0) return i
  }
  return -1
}

export function isRankingsCsvHeader(header: string[]): boolean {
  if (header.length < RANKINGS_CSV_HEADERS.length) return false
  return RANKINGS_CSV_HEADERS.every((name, i) => header[i].trim().toLowerCase() === name)
}

export function rankingsCsvFileError(file: File): string | null {
  if (file.size === 0) return 'That file is empty.'
  if (file.size > MAX_RANKINGS_CSV_BYTES) return 'That CSV is too large to import.'
  const name = file.name.toLowerCase()
  if (name && !name.endsWith('.csv')) return 'Import a .csv file exported from Pre-Draft Rankings.'
  return null
}

export function parseRankingsCsvImport(
  text: string,
  players: RankingsCsvPlayer[],
  options?: { minMatched?: number },
): RankingsCsvImportResult {
  const rows = parseCsv(text)
  if (rows.length === 0) return { ok: false, error: 'That file is not a Pre-Draft Rankings CSV.' }
  if (!isRankingsCsvHeader(rows[0])) {
    return {
      ok: false,
      error: 'That file is not a Pre-Draft Rankings export. Use Export CSV on this page, then import that file.',
    }
  }
  const data = rows.slice(1)
  if (data.length === 0) return { ok: false, error: 'That CSV has a header but no player rows.' }
  if (data.length > MAX_RANKINGS_CSV_ROWS) return { ok: false, error: 'That CSV has too many rows to import.' }

  const byId = new Map(players.map((p) => [p.id, p]))
  const parsed: { rank: number; id: string }[] = []
  for (let i = 0; i < data.length; i++) {
    const row = data[i]
    const rank = Number(row[0]?.trim())
    const id = row[1]?.trim() ?? ''
    const name = row[2]?.trim() ?? ''
    if (!Number.isInteger(rank) || rank < 1) {
      return { ok: false, error: `Row ${i + 2} is not a site export (rank must be a whole number).` }
    }
    if (!id || !name) {
      return { ok: false, error: `Row ${i + 2} is missing an id or name from a site export.` }
    }
    parsed.push({ rank, id })
  }

  parsed.sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))
  const nextOrder: string[] = []
  const unknown: string[] = []
  const seen = new Set<string>()
  for (const row of parsed) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    if (byId.has(row.id)) nextOrder.push(row.id)
    else unknown.push(row.id)
  }

  if (nextOrder.length === 0) {
    return { ok: false, error: 'None of the player ids in that CSV match the current ADP board.' }
  }
  const minMatched = options?.minMatched ?? Math.min(10, players.length)
  if (nextOrder.length < minMatched) {
    return {
      ok: false,
      error:
        options?.minMatched != null
          ? `That CSV matched ${nextOrder.length} players; this mock needs at least ${minMatched} (league size × rounds).`
          : `Too few player ids matched the current board (${nextOrder.length}). This does not look like a file exported from this page.`,
    }
  }
  const enoughForDraft = options?.minMatched != null && nextOrder.length >= options.minMatched
  if (!enoughForDraft && unknown.length / parsed.length > MAX_UNMATCHED_RATIO) {
    return {
      ok: false,
      error: `Too many unknown player ids (${unknown.length} of ${parsed.length}). Import a CSV exported from this page.`,
    }
  }

  return {
    ok: true,
    order: mergeOrder(nextOrder, players.map((p) => p.id)),
    matched: nextOrder.length,
    unknown,
  }
}

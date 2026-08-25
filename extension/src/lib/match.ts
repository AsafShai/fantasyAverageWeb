import { normalizeName, normalizeTeam } from './normalize'
import type { EspnBoardRow, RankedPlayer } from './types'

export const APPLY_TOP_N = 300

export type MatchResult = {
  next: EspnBoardRow[]
  matched: number
  unmatchedCsv: RankedPlayer[]
  unmatchedEspn: EspnBoardRow[]
}

function nameKey(name: string): string {
  return normalizeName(name)
}

function teamKey(team: string): string {
  return normalizeTeam(team)
}

function findMatch(player: RankedPlayer, rows: EspnBoardRow[], used: Set<number>): number | null {
  if (player.espnId != null) {
    const byId = rows.findIndex((row, i) => !used.has(i) && row.espnId === player.espnId)
    if (byId >= 0) return byId
  }

  const wantName = nameKey(player.name)
  if (!wantName) return null
  const wantTeam = teamKey(player.team)

  const unused = rows
    .map((row, i) => ({ row, i }))
    .filter(({ i, row }) => !used.has(i) && nameKey(row.name) === wantName)

  if (unused.length === 0) return null
  if (wantTeam) {
    const withTeam = unused.filter(({ row }) => teamKey(row.team) === wantTeam)
    if (withTeam.length === 1) return withTeam[0].i
    return null
  }
  if (unused.length === 1) return unused[0].i
  return null
}

export function topPlayers(players: RankedPlayer[], limit = APPLY_TOP_N): RankedPlayer[] {
  return [...players].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name)).slice(0, limit)
}

export function findPlayerIndex(player: RankedPlayer, rows: EspnBoardRow[]): number | null {
  return findMatch(player, rows, new Set())
}

export function csvSlot(player: RankedPlayer): number {
  return Math.max(0, player.rank - 1)
}

export function rowKey(row: Pick<EspnBoardRow, 'espnId' | 'name' | 'team'>): string | null {
  if (row.espnId != null) return `id:${row.espnId}`
  const name = nameKey(row.name)
  if (!name) return null
  const team = teamKey(row.team)
  return team ? `n:${name}|t:${team}` : `n:${name}`
}

export function packedPlacement(
  desired: RankedPlayer[],
  board: EspnBoardRow[],
): { placed: number; missing: number; wrong: number } {
  const match = mergeEspnOrder(topPlayers(desired), board)
  const target = match.next.slice(0, match.matched)
  let placed = 0
  let wrong = 0
  for (let i = 0; i < target.length; i++) {
    const want = rowKey(target[i])
    const got = board[i] ? rowKey(board[i]) : null
    if (want && got === want) placed++
    else wrong++
  }
  return { placed, missing: match.unmatchedCsv.length, wrong }
}

export function mergeEspnOrder(desired: RankedPlayer[], espnRows: EspnBoardRow[]): MatchResult {
  const sorted = topPlayers(desired, desired.length)
  const used = new Set<number>()
  const next: EspnBoardRow[] = []
  const unmatchedCsv: RankedPlayer[] = []

  for (const player of sorted) {
    const idx = findMatch(player, espnRows, used)
    if (idx == null) {
      unmatchedCsv.push(player)
      continue
    }
    used.add(idx)
    next.push(espnRows[idx])
  }

  const unmatchedEspn = espnRows.filter((_, i) => !used.has(i))
  next.push(...unmatchedEspn)
  return {
    next,
    matched: used.size,
    unmatchedCsv,
    unmatchedEspn,
  }
}

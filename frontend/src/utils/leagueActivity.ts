import type { ActivityMove, MoveKind, PlayerStint, Trade } from '../types/activity'

export type StatMode = 'totals' | 'per_game'

// Percentage categories are rebuilt from makes/attempts across the games, never
// averaged from per-game percentages.
const PCT_PARTS: Record<string, [string, string]> = {
  'FG%': ['FGM', 'FGA'],
  'FT%': ['FTM', 'FTA'],
  '3P%': ['3PM', '3PA'],
}

export function isPctCategory(cat: string): boolean {
  return cat in PCT_PARTS
}

export { orderCategories } from './statOrder'

export interface StatLine {
  gp: number
  totals: Record<string, number>
}

export function sumStints(stints: PlayerStint[]): StatLine {
  const totals: Record<string, number> = {}
  let gp = 0
  for (const s of stints) {
    gp += s.games_played
    for (const [k, v] of Object.entries(s.totals)) totals[k] = (totals[k] ?? 0) + v
  }
  return { gp, totals }
}

export function stintLine(s: PlayerStint): StatLine {
  return { gp: s.games_played, totals: s.totals }
}

/** Value of one category for a stat line: a made/attempted ratio for percentage
 * categories, otherwise the total or the per-game average. null = no data. */
export function categoryValue(line: StatLine, cat: string, mode: StatMode): number | null {
  const parts = PCT_PARTS[cat]
  if (parts) {
    const att = line.totals[parts[1]] ?? 0
    return att > 0 ? (line.totals[parts[0]] ?? 0) / att : null
  }
  if (!(cat in line.totals) && line.gp === 0) return null
  const total = line.totals[cat] ?? 0
  if (mode === 'totals') return total
  return line.gp > 0 ? total / line.gp : null
}

export function formatCategory(value: number | null, cat: string, mode: StatMode): string {
  if (value === null) return '–'
  if (isPctCategory(cat)) return value.toFixed(3)
  return mode === 'totals' ? String(Math.round(value)) : value.toFixed(1)
}

export function makesAttempts(line: StatLine, cat: string): string | null {
  const parts = PCT_PARTS[cat]
  if (!parts) return null
  return `${Math.round(line.totals[parts[0]] ?? 0)}/${Math.round(line.totals[parts[1]] ?? 0)}`
}

export function perGameSummary(s: PlayerStint): string {
  if (s.games_played === 0) return 'No games'
  const pg = (k: string) => ((s.totals[k] ?? 0) / s.games_played).toFixed(1)
  return `${pg('PTS')} pts · ${pg('REB')} reb · ${pg('AST')} ast`
}

// --- per-viewer trade overrides ------------------------------------------
// Stored in this browser only. A traded player is counted unless the viewer
// left him out; the open-roster-spot pickup is left out unless they opted in.

export type TradeOverrides = Record<string, boolean>

export const OPEN_SPOT_KEY = 'open_spot'

export function overrideKey(tradeId: string, playerKey: number | string): string {
  return `${tradeId}:${playerKey}`
}

export function isCounted(overrides: TradeOverrides, tradeId: string, playerId: number): boolean {
  return overrides[overrideKey(tradeId, playerId)] !== false
}

export function isOpenSpotCounted(overrides: TradeOverrides, tradeId: string): boolean {
  return overrides[overrideKey(tradeId, OPEN_SPOT_KEY)] === true
}

export function setCounted(
  overrides: TradeOverrides,
  tradeId: string,
  playerKey: number | string,
  counted: boolean,
): TradeOverrides {
  const next = { ...overrides }
  const key = overrideKey(tradeId, playerKey)
  const isDefault = playerKey === OPEN_SPOT_KEY ? !counted : counted
  if (isDefault) delete next[key]
  else next[key] = counted
  return next
}

export function overridesForTrade(overrides: TradeOverrides, tradeId: string): number {
  return Object.keys(overrides).filter(k => k.startsWith(`${tradeId}:`)).length
}

export function resetTrade(overrides: TradeOverrides, tradeId: string): TradeOverrides {
  return Object.fromEntries(Object.entries(overrides).filter(([k]) => !k.startsWith(`${tradeId}:`)))
}

export interface SideRow {
  stint: PlayerStint
  openSpot: boolean
  counted: boolean
}

/** What one team received in a trade, plus its open-spot pickup, with this
 * viewer's include/exclude choices applied. */
export function sideRows(trade: Trade, teamId: number, overrides: TradeOverrides): SideRow[] {
  const side = trade.sides.find(s => s.team_id === teamId)
  const rows: SideRow[] = (side?.received ?? []).map(stint => ({
    stint,
    openSpot: false,
    counted: isCounted(overrides, trade.id, stint.player_id),
  }))
  const spot = trade.open_roster_spot
  if (spot && spot.team_id === teamId) {
    rows.push({ stint: spot.stint, openSpot: true, counted: isOpenSpotCounted(overrides, trade.id) })
  }
  return rows
}

export function countedLine(rows: SideRow[]): StatLine {
  return sumStints(rows.filter(r => r.counted).map(r => r.stint))
}

/** Played clearly fewer games than his NBA team did while on this roster. */
export function missedGames(s: PlayerStint): boolean {
  return s.team_games >= 4 && s.games_played < 0.6 * s.team_games
}

export const SMALL_SAMPLE_GAMES = 5

// --- trade tree ------------------------------------------------------------

export interface TreeStint {
  stint: PlayerStint
  // Set when the team traded him on: that trade and what came back to the team.
  next: TreeTrade | null
}

export interface TreeTrade {
  trade: Trade
  otherTeamId: number
  sentAlongside: PlayerStint[]
  received: TreeStint[]
  // Set when another player this team sent in the same trade already shows
  // its return: that player's name. `received` is then empty.
  shownWith: string | null
}

/** What `teamId`'s side of a trade turned into: each player it received, and,
 * when the team traded him on, what it got back (recursively). Stops at
 * `maxDepth` trades deep; `truncated` lists trade ids where it stopped. */
export function buildTradeTree(
  trades: Trade[],
  rootId: string,
  teamId: number,
  maxDepth: number,
): { root: TreeStint[]; truncated: Set<string>; stints: number; games: number } {
  const byId = new Map(trades.map(t => [t.id, t]))
  const truncated = new Set<string>()
  // Onward trade id -> the player whose branch shows its return. Two players
  // sent in one trade would otherwise repeat (and double-count) that return.
  const shownUnder = new Map<string, string>()
  let stints = 0
  let games = 0

  const walk = (trade: Trade, depth: number, seen: Set<string>): TreeStint[] => {
    const side = trade.sides.find(s => s.team_id === teamId)
    return (side?.received ?? []).map(stint => {
      stints += 1
      games += stint.games_played
      let next: TreeTrade | null = null
      const onward = stint.exit_trade_id ? byId.get(stint.exit_trade_id) : undefined
      if (stint.exit === 'traded' && onward && !seen.has(onward.id)) {
        const other = onward.sides.find(s => s.team_id !== teamId)
        next = {
          trade: onward,
          otherTeamId: other?.team_id ?? 0,
          sentAlongside: (other?.received ?? []).filter(s => s.player_id !== stint.player_id),
          received: [],
          shownWith: shownUnder.get(onward.id) ?? null,
        }
        if (next.shownWith === null) {
          if (depth >= maxDepth) {
            truncated.add(onward.id)
          } else {
            shownUnder.set(onward.id, stint.name)
            next.received = walk(onward, depth + 1, new Set([...seen, onward.id]))
          }
        }
      }
      return { stint, next }
    })
  }

  const root = byId.get(rootId)
  return { root: root ? walk(root, 1, new Set([rootId])) : [], truncated, stints, games }
}

// --- activity feed -----------------------------------------------------------

export type MoveFilter = 'all' | 'add' | 'drop' | 'waiver' | 'trade'

export const MOVE_FILTERS: { value: MoveFilter; label: string }[] = [
  { value: 'all', label: 'All moves' },
  { value: 'add', label: 'Adds' },
  { value: 'drop', label: 'Drops' },
  { value: 'waiver', label: 'Waiver claims' },
  { value: 'trade', label: 'Trades' },
]

export function moveMatchesKind(kind: MoveKind, filter: MoveFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'drop') return kind === 'drop' || kind === 'trade_drop'
  return kind === filter
}

/** Calendar day of a move in the viewer's timezone, as YYYY-MM-DD. */
export function localDay(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export interface MoveQuery {
  teamId: number | null
  kind: MoveFilter
  from: string
  to: string
}

export function filterMoves(moves: ActivityMove[], q: MoveQuery): ActivityMove[] {
  return moves.filter(m => {
    if (q.teamId !== null && m.team_id !== q.teamId && m.other_team_id !== q.teamId) return false
    if (!moveMatchesKind(m.kind, q.kind)) return false
    const day = localDay(m.at)
    if (q.from && day < q.from) return false
    if (q.to && day > q.to) return false
    return true
  })
}

export function formatDay(isoDate: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }): string {
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString('en-US', opts)
}

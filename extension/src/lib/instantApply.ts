import { mergeEspnOrder, topPlayers } from './match'
import type { EspnBoardRow, RankedPlayer } from './types'

export type EspnStorePlayer = { id: number; fullName?: string; proTeamId?: number }

type Sliceable<T> = { slice(): T[] }

export type RankingsComponent = {
  props?: { config?: { constants?: { proTeamsMap?: Record<string, { abbrev?: string } | undefined> } } }
  store: {
    players: Sliceable<EspnStorePlayer>
    excludedPlayers: Sliceable<unknown>
    playerRankMap: Record<string, number>
  }
  updateRankings: (players: unknown) => Record<string, number>
  componentWillReceiveProps: (next: { players: EspnStorePlayer[]; excludedPlayers: unknown[] }) => void
}

export type InstantApplyOutcome = {
  matched: number
  unmatchedCsv: RankedPlayer[]
  expected: EspnBoardRow[]
}

export function isRankingsComponent(value: unknown): value is RankingsComponent {
  if (!value || typeof value !== 'object') return false
  const c = value as Partial<RankingsComponent>
  const store = c.store as Partial<RankingsComponent['store']> | undefined
  return Boolean(
    store &&
      typeof store === 'object' &&
      typeof store.players?.slice === 'function' &&
      typeof store.excludedPlayers?.slice === 'function' &&
      store.playerRankMap &&
      typeof store.playerRankMap === 'object' &&
      typeof c.updateRankings === 'function' &&
      typeof c.componentWillReceiveProps === 'function',
  )
}

export function instantOrder<P extends EspnStorePlayer>(
  desired: RankedPlayer[],
  players: P[],
  teamAbbrev: (proTeamId?: number) => string = () => '',
): { order: P[]; rows: EspnBoardRow[]; matched: number; unmatchedCsv: RankedPlayer[] } {
  const board: EspnBoardRow[] = players.map((p, index) => ({
    espnId: Number.isInteger(p.id) ? p.id : null,
    name: p.fullName ?? '',
    team: teamAbbrev(p.proTeamId),
    index,
  }))
  const match = mergeEspnOrder(topPlayers(desired), board)
  return {
    order: match.next.map((row) => players[row.index]),
    rows: match.next,
    matched: match.matched,
    unmatchedCsv: match.unmatchedCsv,
  }
}

export function applyInstantOrder(component: RankingsComponent, desired: RankedPlayer[]): InstantApplyOutcome | null {
  const players = component.store.players.slice()
  if (players.length < 10) return null
  const teams = component.props?.config?.constants?.proTeamsMap ?? {}
  const plan = instantOrder(desired, players, (id) => (id == null ? '' : teams[String(id)]?.abbrev ?? ''))
  if (plan.matched === 0) return null

  component.componentWillReceiveProps({
    players: plan.order,
    excludedPlayers: component.store.excludedPlayers.slice(),
  })

  const after = component.store.players.slice()
  if (after.length !== plan.order.length) return null
  for (let i = 0; i < after.length; i++) {
    if (after[i]?.id !== plan.order[i]?.id) return null
  }
  const ranks = component.store.playerRankMap
  for (let i = 0; i < plan.matched; i++) {
    if (ranks[String(plan.order[i].id)] !== i) return null
  }
  return { matched: plan.matched, unmatchedCsv: plan.unmatchedCsv, expected: plan.rows }
}

import { describe, expect, it } from 'vitest'
import { applyInstantOrder, instantOrder, isRankingsComponent, type EspnStorePlayer } from './instantApply'
import type { RankedPlayer } from './types'

const TEAMS: Record<string, { abbrev: string }> = { '1': { abbrev: 'ATL' }, '2': { abbrev: 'BOS' } }

function espnPlayers(n: number): EspnStorePlayer[] {
  return Array.from({ length: n }, (_, i) => ({ id: 1000 + i, fullName: `Player ${i}`, proTeamId: (i % 2) + 1 }))
}

function ranked(ids: number[]): RankedPlayer[] {
  return ids.map((id, i) => ({ rank: i + 1, espnId: id, name: `Player ${id - 1000}`, team: '' }))
}

function fakeEspnComponent(players: EspnStorePlayer[]) {
  const component = {
    props: { config: { constants: { proTeamsMap: TEAMS } } },
    store: {
      players: [...players],
      excludedPlayers: [] as unknown[],
      playerRankMap: {} as Record<string, number>,
    },
    updateRankings(list: EspnStorePlayer[]) {
      const map: Record<string, number> = {}
      list.forEach((p, i) => {
        map[p.id] = i
      })
      return map
    },
    componentWillReceiveProps(next: { players: EspnStorePlayer[]; excludedPlayers: unknown[] }) {
      component.store.players = [...next.players]
      component.store.excludedPlayers = [...next.excludedPlayers]
      component.store.playerRankMap = component.updateRankings(component.store.players)
    },
  }
  component.store.playerRankMap = component.updateRankings(component.store.players)
  return component
}

describe('instantOrder', () => {
  it('puts CSV players first and keeps the rest in ESPN order', () => {
    const players = espnPlayers(5)
    const plan = instantOrder(ranked([1003, 1001]), players)
    expect(plan.order.map((p) => p.id)).toEqual([1003, 1001, 1000, 1002, 1004])
    expect(plan.matched).toBe(2)
  })

  it('matches by name and team when the CSV has no ESPN id', () => {
    const players = espnPlayers(4)
    const desired: RankedPlayer[] = [{ rank: 1, espnId: null, name: 'Player 3', team: 'BOS' }]
    const plan = instantOrder(desired, players, (id) => (id ? TEAMS[String(id)].abbrev : ''))
    expect(plan.order[0].id).toBe(1003)
  })

  it('reports CSV players missing from ESPN', () => {
    const plan = instantOrder(ranked([9999, 1002]), espnPlayers(3))
    expect(plan.unmatchedCsv.map((p) => p.espnId)).toEqual([9999])
    expect(plan.order[0].id).toBe(1002)
  })
})

describe('applyInstantOrder', () => {
  it('reorders the store and rank map in one call', () => {
    const component = fakeEspnComponent(espnPlayers(20))
    const outcome = applyInstantOrder(component, ranked([1019, 1005, 1010]))
    expect(outcome?.matched).toBe(3)
    expect(component.store.players.slice(0, 4).map((p) => p.id)).toEqual([1019, 1005, 1010, 1000])
    expect(component.store.playerRankMap['1019']).toBe(0)
    expect(component.store.playerRankMap['1000']).toBe(3)
  })

  it('keeps excluded players as they were', () => {
    const component = fakeEspnComponent(espnPlayers(20))
    const excluded = [{ id: 5, rank: 2 }]
    component.store.excludedPlayers = excluded
    applyInstantOrder(component, ranked([1001]))
    expect(component.store.excludedPlayers).toEqual(excluded)
  })

  it('returns null when ESPN ignores the update', () => {
    const component = fakeEspnComponent(espnPlayers(20))
    component.componentWillReceiveProps = () => {}
    expect(applyInstantOrder(component, ranked([1019]))).toBeNull()
  })

  it('returns null when nothing matches', () => {
    const component = fakeEspnComponent(espnPlayers(20))
    expect(applyInstantOrder(component, ranked([9999]))).toBeNull()
  })
})

describe('isRankingsComponent', () => {
  it('accepts the ESPN rankings component shape', () => {
    expect(isRankingsComponent(fakeEspnComponent(espnPlayers(3)))).toBe(true)
  })

  it('rejects the salary-cap component, which has no rank map', () => {
    const component = fakeEspnComponent(espnPlayers(3)) as Record<string, unknown>
    component.store = { players: [], excludedPlayers: [] }
    expect(isRankingsComponent(component)).toBe(false)
  })
})

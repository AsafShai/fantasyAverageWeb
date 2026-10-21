import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureStore } from '@reduxjs/toolkit'
import { fantasyApi } from '../fantasyApi'

function makeStore() {
  return configureStore({
    reducer: { [fantasyApi.reducerPath]: fantasyApi.reducer },
    middleware: (getDefault) => getDefault().concat(fantasyApi.middleware),
  })
}

const playersPage = { players: [], total_count: 0, page: 1, limit: 1200, has_more: false }

describe('getAllPlayers', () => {
  afterEach(() => vi.restoreAllMocks())

  it('shares one request between args that differ only by spelled-out defaults', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(JSON.stringify(playersPage), { headers: { 'Content-Type': 'application/json' } }),
    )
    const store = makeStore()

    await Promise.all([
      store.dispatch(fantasyApi.endpoints.getAllPlayers.initiate({ page: 1, limit: 1200 })),
      store.dispatch(fantasyApi.endpoints.getAllPlayers.initiate({ limit: 1200, time_period: 'season' })),
      store.dispatch(fantasyApi.endpoints.getAllPlayers.initiate({ page: 1, limit: 1200, time_period: 'season' })),
    ])

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const url = new URL((fetchSpy.mock.calls[0][0] as Request).url)
    expect(url.pathname).toMatch(/\/players\/$/)
    expect(Object.fromEntries(url.searchParams)).toEqual({ page: '1', limit: '1200', time_period: 'season' })
  })

  it('still keeps different lists apart', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(JSON.stringify(playersPage), { headers: { 'Content-Type': 'application/json' } }),
    )
    const store = makeStore()

    await Promise.all([
      store.dispatch(fantasyApi.endpoints.getAllPlayers.initiate({ limit: 1200 })),
      store.dispatch(fantasyApi.endpoints.getAllPlayers.initiate({ limit: 1200, time_period: 'last_7' })),
      store.dispatch(fantasyApi.endpoints.getAllPlayers.initiate({ limit: 1200, time_period: 'custom', start: '2026-10-20', end: '2026-10-25' })),
    ])

    expect(fetchSpy).toHaveBeenCalledTimes(3)
  })
})

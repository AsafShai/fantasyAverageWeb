import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useLiveQuery } from '../useLiveQuery'
import type { LiveBlock } from '../../utils/live'

const live: LiveBlock = { active: true, period: 24, as_of: null, games_total: 4, games_live: 2, games_final: 0, official_updated_at: null }

describe('useLiveQuery', () => {
  it('starts without polling, then polls at 60 s skipping unfocused tabs once the data says games are live', () => {
    let data: { live?: LiveBlock } | undefined
    const useQuery = vi.fn<(arg: unknown, opts: object) => { data: { live?: LiveBlock } | undefined }>(() => ({ data }))
    const { rerender } = renderHook(() => useLiveQuery(useQuery, 'x'))
    expect(useQuery.mock.calls.at(-1)![1]).toMatchObject({ pollingInterval: 0, skipPollingIfUnfocused: true })
    data = { live }
    rerender()
    rerender()
    expect(useQuery.mock.calls.at(-1)![1]).toMatchObject({ pollingInterval: 60_000, skipPollingIfUnfocused: true })
    data = { live: { ...live, games_live: 0, games_final: 4 } }
    rerender()
    rerender()
    expect(useQuery.mock.calls.at(-1)![1]).toMatchObject({ pollingInterval: 0 })
  })

  it('passes through extra options such as skip', () => {
    const useQuery = vi.fn<(arg: unknown, opts: object) => { data: { live?: LiveBlock } | undefined }>(() => ({ data: undefined }))
    renderHook(() => useLiveQuery(useQuery, 'x', { skip: true }))
    expect(useQuery.mock.calls.at(-1)![1]).toMatchObject({ skip: true })
  })
})

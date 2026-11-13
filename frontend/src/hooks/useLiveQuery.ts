import { useState } from 'react'
import { livePollMs, type LiveBlock } from '../utils/live'

type QueryHook<A, R extends { data?: { live?: LiveBlock } | undefined }> = (arg: A, options: object) => R

/**
 * Wraps an RTK Query hook so it polls every 60 s while the response's `live`
 * block says games are in progress, and not otherwise. Hidden tabs do not
 * poll. With no `live` block (backend flag off) it never polls.
 */
export function useLiveQuery<A, R extends { data?: { live?: LiveBlock } | undefined }>(
  useQuery: QueryHook<A, R>,
  arg: A,
  options: object = {},
): R {
  const [pollingInterval, setPollingInterval] = useState(0)
  const result = useQuery(arg, { ...options, pollingInterval, skipPollingIfUnfocused: true })
  const wanted = livePollMs(result.data?.live)
  // Adjusting state during render: the interval follows what the last response said.
  if (wanted !== pollingInterval) setPollingInterval(wanted)
  return result
}

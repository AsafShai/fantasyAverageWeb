import { useCallback, useMemo } from 'react'
import { usePersistedState } from './usePersistedState'
import { sitesForMetric, type AdpSiteKey } from '../utils/adp'
import type { AdpMetric, ProviderMeta } from '../types/api'

const STORAGE_KEYS: Record<AdpMetric, string> = {
  adp: 'draft.adp.visibleSites',
  rank: 'draft.rank.visibleSites',
}

export type BlendSites = {
  /** Sites shown as columns and counted in the active view's Blend. */
  sites: AdpSiteKey[]
  /** Every site that has data for the active view — the checkbox row. */
  available: AdpSiteKey[]
  toggle: (site: AdpSiteKey) => void
  /** `sites` params for the request: both views travel together so the two blends stay in sync. */
  sitesParam: string
  rankSitesParam: string
}

/**
 * The one place the per-view blend-site selection lives.
 *
 * All three draft pages read it, so it cannot be re-implemented per page — three copies of
 * the same localStorage key drift apart. Both views' selections are read on every call
 * (hook order is fixed) and both are sent on every request, because the pre-draft board
 * shows an ADP-vs-rankings delta and so needs both blends narrowed correctly at once.
 */
export function useBlendSites(metric: AdpMetric, providers?: ProviderMeta[]): BlendSites {
  const [adpRaw, setAdpRaw] = usePersistedState<AdpSiteKey[]>(STORAGE_KEYS.adp, [
    ...sitesForMetric('adp'),
  ])
  const [rankRaw, setRankRaw] = usePersistedState<AdpSiteKey[]>(STORAGE_KEYS.rank, [
    ...sitesForMetric('rank'),
  ])

  const adpAvailable = useMemo(() => sitesForMetric('adp', providers), [providers])
  const rankAvailable = useMemo(() => sitesForMetric('rank', providers), [providers])

  // A stored list can name a site the active view has no data for (a rollback, a provider
  // that went down); unknown entries are dropped and an empty result falls back to every
  // available site, so unchecking everything can never strand the page blank across reloads.
  const resolve = (stored: AdpSiteKey[], available: AdpSiteKey[]) => {
    const chosen = new Set(stored)
    const ordered = available.filter((site) => chosen.has(site))
    return ordered.length ? ordered : available
  }

  const adpSites = useMemo(() => resolve(adpRaw, adpAvailable), [adpRaw, adpAvailable])
  const rankSites = useMemo(() => resolve(rankRaw, rankAvailable), [rankRaw, rankAvailable])

  const setRaw = metric === 'adp' ? setAdpRaw : setRankRaw
  const toggle = useCallback(
    (site: AdpSiteKey) => {
      setRaw((prev) => (prev.includes(site) ? prev.filter((s) => s !== site) : [...prev, site]))
    },
    [setRaw],
  )

  return {
    sites: metric === 'adp' ? adpSites : rankSites,
    available: metric === 'adp' ? adpAvailable : rankAvailable,
    toggle,
    sitesParam: adpSites.join(','),
    rankSitesParam: rankSites.join(','),
  }
}

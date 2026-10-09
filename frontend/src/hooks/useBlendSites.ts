import { useCallback, useMemo } from 'react'
import { usePersistedState } from './usePersistedState'
import {
  blendSitesParam,
  equalWeights,
  sitesForMetric,
  weightsTotal,
  type AdpSiteKey,
  type SiteWeights,
} from '../utils/adp'
import type { AdpMetric, ProviderMeta } from '../types/api'

const STORAGE_KEYS: Record<AdpMetric, string> = {
  adp: 'draft.adp.visibleSites',
  rank: 'draft.rank.visibleSites',
}

const WEIGHT_KEYS: Record<AdpMetric, string> = {
  adp: 'draft.adp.siteWeights',
  rank: 'draft.rank.siteWeights',
}

type StoredWeights = { enabled: boolean; percents: SiteWeights }

const NO_WEIGHTS: StoredWeights = { enabled: false, percents: {} }

export type BlendWeights = {
  /** The user turned the weighted average on for the active view. */
  enabled: boolean
  /** Percent per checked site; a site with no entry is 0. */
  percents: SiteWeights
  /** Sum over the checked sites. */
  total: number
  /** Enabled and totalling 100 -- only then do the weights reach the Blend. */
  applied: boolean
  setEnabled: (on: boolean) => void
  setPercent: (site: AdpSiteKey, percent: number) => void
  splitEvenly: () => void
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
  /** Weighted-average settings for the active view. */
  weights: BlendWeights
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

  const [adpWeights, setAdpWeights] = usePersistedState<StoredWeights>(WEIGHT_KEYS.adp, NO_WEIGHTS)
  const [rankWeights, setRankWeights] = usePersistedState<StoredWeights>(WEIGHT_KEYS.rank, NO_WEIGHTS)

  // Weights reach the request only while enabled and totalling exactly 100 over the
  // checked sites, so a half-typed set never reorders the list under the user.
  const appliedWeights = (stored: StoredWeights, sites: AdpSiteKey[]) =>
    stored.enabled && weightsTotal(sites, stored.percents) === 100 ? stored.percents : null

  const setRaw = metric === 'adp' ? setAdpRaw : setRankRaw
  const toggle = useCallback(
    (site: AdpSiteKey) => {
      setRaw((prev) => (prev.includes(site) ? prev.filter((s) => s !== site) : [...prev, site]))
    },
    [setRaw],
  )

  const activeSites = metric === 'adp' ? adpSites : rankSites
  const activeWeights = metric === 'adp' ? adpWeights : rankWeights
  const setWeights = metric === 'adp' ? setAdpWeights : setRankWeights
  const weights: BlendWeights = {
    enabled: activeWeights.enabled,
    percents: activeWeights.percents,
    total: weightsTotal(activeSites, activeWeights.percents),
    applied: appliedWeights(activeWeights, activeSites) !== null,
    // Turning it on for the first time starts from an even split, not from all zeros.
    setEnabled: (on) =>
      setWeights((prev) => ({
        enabled: on,
        percents: on && weightsTotal(activeSites, prev.percents) === 0 ? equalWeights(activeSites) : prev.percents,
      })),
    setPercent: (site, percent) =>
      setWeights((prev) => ({
        ...prev,
        percents: { ...prev.percents, [site]: Math.min(100, Math.max(0, Math.round(percent) || 0)) },
      })),
    splitEvenly: () => setWeights((prev) => ({ ...prev, percents: equalWeights(activeSites) })),
  }

  return {
    sites: activeSites,
    available: metric === 'adp' ? adpAvailable : rankAvailable,
    toggle,
    sitesParam: blendSitesParam(adpSites, appliedWeights(adpWeights, adpSites)),
    rankSitesParam: blendSitesParam(rankSites, appliedWeights(rankWeights, rankSites)),
    weights,
  }
}

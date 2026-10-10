import { useCallback, useMemo } from 'react'
import { useDebounce } from './useDebounce'
import { usePersistedState } from './usePersistedState'
import {
  blendSitesParam,
  equalWeights,
  isEvenSplit,
  roundedWeights,
  paramSites,
  rebalanceWeights,
  sitesForMetric,
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

/**
 * `forSites` is the checked-site list the percents and locks were set for (comma-joined).
 * Checking or unchecking a site makes it stale, and the weights start again from an even
 * split with nothing locked -- re-checking a site never brings back an older set.
 */
type StoredWeights = { enabled: boolean; percents: SiteWeights; locked?: AdpSiteKey[]; forSites?: string }

const WEIGHT_DEBOUNCE_MS = 300

const NO_WEIGHTS: StoredWeights = { enabled: false, percents: {} }

export type BlendWeights = {
  /** The user turned the weighted average on for the active view. */
  enabled: boolean
  /** Percent per checked site, always totalling 100 (an even split by default). */
  percents: SiteWeights
  /** The percents are an even split (the default, or after Split evenly). */
  even: boolean
  /** Checked sites the user froze: moving another slider never changes them. */
  locked: AdpSiteKey[]
  setEnabled: (on: boolean) => void
  /** Sets one site and rebalances the unlocked others so the total stays 100. */
  setPercent: (site: AdpSiteKey, percent: number) => void
  toggleLock: (site: AdpSiteKey) => void
  /** Even split, nothing locked. */
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

  const effectiveWeights = (stored: StoredWeights, sites: AdpSiteKey[]) =>
    stored.forSites === sites.join(',') ? stored.percents : equalWeights(sites)
  // An even split is sent as the plain site list: 34/33/33 would otherwise nudge the Blend
  // off the plain mean (19.9 instead of 20) and flip close ranks.
  const appliedWeights = (stored: StoredWeights, sites: AdpSiteKey[]) => {
    if (!stored.enabled) return null
    const percents = effectiveWeights(stored, sites)
    return isEvenSplit(sites, percents) ? null : percents
  }

  // A slider fires on every step of a drag; wait for it to settle before the weights reach
  // the request. A change of checked sites still goes out at once.
  const adpParam = blendSitesParam(adpSites, appliedWeights(adpWeights, adpSites))
  const rankParam = blendSitesParam(rankSites, appliedWeights(rankWeights, rankSites))
  const adpParamSettled = useDebounce(adpParam, WEIGHT_DEBOUNCE_MS)
  const rankParamSettled = useDebounce(rankParam, WEIGHT_DEBOUNCE_MS)
  const settled = (param: string, debounced: string) =>
    paramSites(debounced) === paramSites(param) ? debounced : param

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
  const activePercents = effectiveWeights(activeWeights, activeSites)
  // Locks only mean something with three or more sites: with two, a lock would freeze both
  // sliders, and the lock buttons are not shown to undo it.
  const forSites = activeSites.join(',')
  const lockedOf = (stored: StoredWeights) =>
    activeSites.length <= 2 || stored.forSites !== forSites ? [] : (stored.locked ?? [])
  const weights: BlendWeights = {
    enabled: activeWeights.enabled,
    percents: roundedWeights(activeSites, activePercents),
    even: isEvenSplit(activeSites, activePercents),
    locked: lockedOf(activeWeights),
    setEnabled: (on) => setWeights((prev) => ({ ...prev, enabled: on })),
    setPercent: (site, percent) =>
      setWeights((prev) => ({
        ...prev,
        percents: rebalanceWeights(activeSites, effectiveWeights(prev, activeSites), site, percent, lockedOf(prev)),
        locked: lockedOf(prev),
        forSites,
      })),
    toggleLock: (site) =>
      setWeights((prev) => {
        const locked = lockedOf(prev)
        return {
          ...prev,
          percents: effectiveWeights(prev, activeSites),
          locked: locked.includes(site) ? locked.filter((s) => s !== site) : [...locked, site],
          forSites,
        }
      }),
    splitEvenly: () => setWeights((prev) => ({ ...prev, percents: equalWeights(activeSites), locked: [], forSites })),
  }

  return {
    sites: activeSites,
    available: metric === 'adp' ? adpAvailable : rankAvailable,
    toggle,
    sitesParam: settled(adpParam, adpParamSettled),
    rankSitesParam: settled(rankParam, rankParamSettled),
    weights,
  }
}

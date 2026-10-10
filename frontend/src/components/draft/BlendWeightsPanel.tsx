import { SITE_LABEL, evenSplitLabel, type AdpSiteKey } from '../../utils/adp'
import type { BlendWeights } from '../../hooks/useBlendSites'

type Props = {
  /** The checked sites -- only these get a percent. */
  sites: AdpSiteKey[]
  weights: BlendWeights
}

function LockIcon({ locked }: { locked: boolean }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4" aria-hidden="true">
      <rect x="4" y="9" width="12" height="8" rx="1.5" />
      <path d={locked ? 'M7 9V6.5a3 3 0 0 1 6 0V9' : 'M7 9V6.5a3 3 0 0 1 5.8-1.1'} strokeLinecap="round" />
    </svg>
  )
}

/**
 * Advanced: a weighted Blend instead of a plain average. Off by default; when on, each
 * checked site gets a slider. The percents start even and always total 100 -- moving one
 * slider rebalances the unlocked others, and a locked site stays where it is.
 */
export default function BlendWeightsPanel({ sites, weights }: Props) {
  const { enabled, percents, even, locked, setEnabled, setPercent, toggleLock, splitEvenly } = weights

  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
      <label className="inline-flex items-center gap-2 text-sm cursor-pointer py-1 lg:py-0">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="rounded border-gray-300"
        />
        <span className="font-medium text-gray-700 dark:text-gray-200">Weighted average</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300">
          Advanced
        </span>
      </label>
      {enabled ? (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {sites.map((site) => {
            const isLocked = locked.includes(site)
            // A slider needs an unlocked partner to trade percent with.
            const canMove = !isLocked && sites.some((s) => s !== site && !locked.includes(s))
            return (
              <div key={site} className="flex w-full sm:w-auto items-center gap-2 text-sm">
                <span className="w-14 shrink-0 text-gray-600 dark:text-gray-300">{SITE_LABEL[site]}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={percents[site] ?? 0}
                  disabled={!canMove}
                  onChange={(e) => setPercent(site, Number(e.target.value))}
                  aria-label={`${SITE_LABEL[site]} weight percent`}
                  className="min-w-0 flex-1 sm:w-28 sm:flex-none accent-blue-600 disabled:opacity-50"
                />
                <span className="w-12 shrink-0 text-right font-semibold tabular-nums text-gray-700 dark:text-gray-200">
                  {even ? evenSplitLabel(sites.length) : (percents[site] ?? 0)}%
                </span>
                {sites.length > 2 ? (
                  <button
                    type="button"
                    onClick={() => toggleLock(site)}
                    aria-pressed={isLocked}
                    aria-label={`${isLocked ? 'Unlock' : 'Lock'} ${SITE_LABEL[site]}`}
                    title={isLocked ? 'Locked: other sliders will not change it' : 'Lock this site'}
                    className={`shrink-0 inline-flex items-center justify-center min-h-11 min-w-11 lg:min-h-0 lg:min-w-0 lg:p-1 rounded ${
                      isLocked
                        ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30'
                        : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'
                    }`}
                  >
                    <LockIcon locked={isLocked} />
                  </button>
                ) : null}
              </div>
            )
          })}
          <button
            type="button"
            onClick={splitEvenly}
            className="min-h-11 lg:min-h-0 px-2 py-1 rounded text-xs font-semibold border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300"
          >
            Split evenly
          </button>
        </div>
      ) : null}
    </div>
  )
}

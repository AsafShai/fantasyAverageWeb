import { SITE_LABEL, type AdpSiteKey } from '../../utils/adp'
import type { BlendWeights } from '../../hooks/useBlendSites'

type Props = {
  /** The checked sites -- only these get a percent. */
  sites: AdpSiteKey[]
  weights: BlendWeights
}

/**
 * Advanced: a weighted Blend instead of a plain average. Off by default; when on, each
 * checked site gets a percent, and the weights apply only once they total 100.
 */
export default function BlendWeightsPanel({ sites, weights }: Props) {
  const { enabled, percents, total, applied, setEnabled, setPercent, splitEvenly } = weights

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
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {sites.map((site) => (
            <label key={site} className="inline-flex items-center gap-1.5 text-sm">
              <span className="text-gray-600 dark:text-gray-300">{SITE_LABEL[site]}</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={100}
                step={5}
                value={percents[site] ?? 0}
                onChange={(e) => setPercent(site, Number(e.target.value))}
                aria-label={`${SITE_LABEL[site]} weight percent`}
                className="w-16 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-2 lg:py-1 text-base sm:text-sm text-right tabular-nums"
              />
              <span className="text-gray-500">%</span>
            </label>
          ))}
          <span
            className={`text-sm font-semibold tabular-nums ${
              applied ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            Total {total}%
          </span>
          {!applied ? (
            <span className="text-xs text-rose-600 dark:text-rose-400">
              Must total 100% to apply. Blend is a plain average until then.
            </span>
          ) : null}
          <button
            type="button"
            onClick={splitEvenly}
            className="min-h-11 lg:min-h-0 px-2 py-1 rounded text-xs font-semibold border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300"
          >
            Split evenly
          </button>
          <span
            className="hidden lg:inline text-xs text-gray-400"
            title="If a site does not list a player, its share is spread over the other sites in proportion."
          >
            Missing site? Its share goes to the others.
          </span>
        </div>
      ) : null}
    </div>
  )
}

const SWATCH = (className: string) => (
  <span className={`inline-block h-3 w-3 rounded shrink-0 border border-black/10 dark:border-white/10 ${className}`} />
)

/** Green / amber / gray key for the Poeltl-style guess grid. */
export default function WhoAmIFeedbackLegend() {
  return (
    <div
      className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400 mb-2"
      aria-label="Clue color legend"
    >
      <span className="inline-flex items-center gap-1.5">
        {SWATCH('bg-green-200 dark:bg-green-800/60')} Match
      </span>
      <span className="inline-flex items-center gap-1.5">
        {SWATCH('bg-amber-200 dark:bg-amber-800/60')} Close
      </span>
      <span className="inline-flex items-center gap-1.5">
        {SWATCH('bg-gray-200 dark:bg-gray-700')} Wrong
      </span>
      <span className="hidden sm:inline">↑↓ = higher / lower</span>
    </div>
  )
}

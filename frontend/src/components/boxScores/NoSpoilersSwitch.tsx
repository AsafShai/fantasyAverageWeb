function EyeOffIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3l18 18" />
      <path d="M10.58 10.58a2 2 0 002.83 2.83" />
      <path d="M9.88 5.09A10.94 10.94 0 0112 4.9c5.05 0 9.27 3.11 10.5 7.1a11.8 11.8 0 01-3.17 4.87" />
      <path d="M6.11 6.11A11.8 11.8 0 001.5 12c1.23 3.99 5.45 7.1 10.5 7.1 1.18 0 2.31-.19 3.36-.54" />
    </svg>
  )
}

/** Full box / No spoilers. Box Scores and the team page's Daily roster share the setting (boxScores.noSpoilers). */
export default function NoSpoilersSwitch({ on, onChange }: { on: boolean; onChange: (next: boolean) => void }) {
  const idle = 'rounded-full px-3 py-1.5 text-sm font-semibold text-gray-500 transition-colors hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 dark:text-gray-400 dark:hover:text-gray-100'
  return (
    <div
      role="group"
      aria-label="Spoiler visibility"
      className={`inline-flex w-fit max-w-full self-center rounded-full p-1 ring-1 transition-colors sm:self-auto ${
        on
          ? 'bg-indigo-50 ring-indigo-200 dark:bg-indigo-950/70 dark:ring-indigo-500/40'
          : 'bg-gray-100 ring-gray-200 dark:bg-gray-800/80 dark:ring-gray-700'
      }`}
    >
      <button
        type="button"
        aria-pressed={!on}
        onClick={() => onChange(false)}
        className={!on
          ? 'rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-gray-900 shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 dark:bg-gray-700 dark:text-white'
          : idle}
      >
        Full box
      </button>
      <button
        type="button"
        aria-pressed={on}
        onClick={() => onChange(true)}
        className={on
          ? 'inline-flex items-center gap-1.5 rounded-full bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300'
          : `inline-flex items-center gap-1.5 ${idle}`}
      >
        <EyeOffIcon />
        No spoilers
      </button>
    </div>
  )
}

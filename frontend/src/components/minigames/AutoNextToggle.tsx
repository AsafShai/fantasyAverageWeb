function SwitchTrack({ checked }: { checked: boolean }) {
  return (
    <span
      className={`mg-auto-next__track relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border-2 transition-colors duration-200 ${
        checked
          ? 'border-blue-600 bg-blue-600 dark:border-blue-500 dark:bg-blue-500'
          : 'border-gray-300 bg-gray-200 dark:border-gray-600 dark:bg-gray-700'
      }`}
      aria-hidden
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${
          checked ? 'translate-x-[1.05rem]' : 'translate-x-0.5'
        }`}
      />
    </span>
  )
}

/** Pill + iOS-style switch for streak games’ auto-advance between rounds. */
export default function AutoNextToggle({
  checked,
  onChange,
  label,
  compact = false,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  /** e.g. "Auto next (3s)" */
  label: string
  /** Toolbar row: flat row with smaller switch */
  compact?: boolean
}) {
  if (compact) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className="mg-auto-next mg-auto-next--compact inline-flex items-center gap-2 rounded-lg px-0.5 py-0.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900"
      >
        <span className="truncate text-xs font-medium text-gray-700 dark:text-gray-200">{label}</span>
        <SwitchTrack checked={checked} />
      </button>
    )
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`mg-auto-next inline-flex items-center gap-3 rounded-full border px-3 py-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900 ${
        checked
          ? 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40'
          : 'border-gray-200 bg-gray-50 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800/60 dark:hover:bg-gray-800'
      }`}
    >
      <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{label}</span>
      <SwitchTrack checked={checked} />
    </button>
  )
}

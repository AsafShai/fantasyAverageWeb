interface TeamTraceButtonProps {
  abbreviation: string
  traced: boolean
  onToggle: (abbreviation: string) => void
}

export default function TeamTraceButton({ abbreviation, traced, onToggle }: TeamTraceButtonProps) {
  return (
    <button
      type="button"
      onClick={event => {
        event.stopPropagation()
        onToggle(abbreviation)
      }}
      aria-pressed={traced}
      aria-label={traced ? `Stop tracing ${abbreviation}` : `Trace ${abbreviation} across the window`}
      className={`rounded border px-1.5 py-1 text-[10px] font-extrabold tabular-nums tracking-wide transition-colors sm:text-[11px] ${
        traced
          ? 'border-blue-700 bg-blue-700 text-white'
          : 'border-gray-200 bg-white text-gray-900 hover:border-blue-700 hover:bg-blue-50 hover:text-blue-700'
      }`}
    >
      {abbreviation}
    </button>
  )
}

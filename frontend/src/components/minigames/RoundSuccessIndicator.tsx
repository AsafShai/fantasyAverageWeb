/** Compact flash after a correct pick — keeps the board visible underneath. */
export default function RoundSuccessIndicator({ message = 'Correct!' }: { message?: string }) {
  return (
    <p
      className="inline-flex items-center gap-1.5 rounded-full border border-green-300/80 dark:border-green-700 bg-green-50 dark:bg-green-950/50 px-3 py-1 text-sm font-semibold text-green-700 dark:text-green-300 shadow-sm"
      role="status"
    >
      <span className="text-base leading-none" aria-hidden>
        ✓
      </span>
      {message}
    </p>
  )
}

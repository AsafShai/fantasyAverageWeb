/** Compact label for roster schedule / who-plays rows. */
export default function BackToBackMark({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1 py-px text-[9px] font-bold uppercase leading-none tracking-wide text-amber-900 bg-amber-100 dark:bg-amber-950/70 dark:text-amber-300 ${className}`.trim()}
      title="Back-to-back game"
    >
      B2B
    </span>
  )
}

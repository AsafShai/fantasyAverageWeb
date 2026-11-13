import { liveMoment, type LiveBlock } from '../../utils/live'

const TONE = {
  live: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-800',
  final: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800',
  official: 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-gray-700 dark:text-blue-200 dark:border-gray-600',
}

/** The strip under a date range that ends today (replaces the "closest available data" note there). */
export default function LiveRangeNote({ live, text, className = 'px-6 py-2 border-b' }: { live?: LiveBlock | null; text: string; className?: string }) {
  const tone = liveMoment(live) ?? 'official'
  return (
    <div data-testid="live-range-note" className={`${className} text-sm ${TONE[tone]}`}>
      {text}
    </div>
  )
}

import { waiverClear } from '../utils/waiverClear'

/** "Clears Sun 3 AM" pill next to a player on waivers; nothing for anyone else. */
export default function WaiverClearTag({ clearsAt, large = false }: { clearsAt?: string | null; large?: boolean }) {
  const clear = waiverClear(clearsAt)
  if (!clear) return null
  const style = clear.soon
    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
    : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
  return (
    <span
      title={clear.full}
      className={`inline-flex items-center gap-1 rounded font-medium whitespace-nowrap ${large ? 'px-2 py-0.5 text-xs border border-amber-300 dark:border-amber-800' : 'px-1.5 py-0.5 text-[10px] leading-none'} ${style}`}
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" className={large ? 'w-3 h-3' : 'w-2.5 h-2.5'} fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="8" cy="8" r="6.2" />
        <path d="M8 4.6V8l2.3 1.6" strokeLinecap="round" />
      </svg>
      Clears {clear.when}{large ? ' ET' : ''}
    </span>
  )
}

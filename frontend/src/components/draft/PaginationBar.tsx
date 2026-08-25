import { useState } from 'react'
import { PAGE_SIZES, pageItems, type PageSize } from '../../utils/pagination'

function pagerButtonClass(active: boolean, disabled?: boolean) {
  if (disabled)
    return 'px-2 py-1.5 sm:py-1 rounded text-xs border border-gray-200 dark:border-gray-700 text-gray-300 dark:text-gray-600 cursor-not-allowed'
  if (active) return 'px-2 py-1.5 sm:py-1 rounded text-xs font-semibold border bg-blue-600 text-white border-blue-600'
  return 'px-2 py-1.5 sm:py-1 rounded text-xs font-semibold border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
}

function JumpToPage({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (page: number) => void }) {
  const [draft, setDraft] = useState(String(page))
  const [syncedTo, setSyncedTo] = useState(page)
  // Adopt a page change that came from elsewhere (Prev/Next, a filter reset) without an
  // effect, so the box never shows a page the list is not on.
  if (syncedTo !== page) {
    setSyncedTo(page)
    setDraft(String(page))
  }

  const commit = () => {
    const parsed = Number(draft)
    if (!Number.isFinite(parsed)) {
      setDraft(String(page))
      return
    }
    const clamped = Math.min(Math.max(1, Math.round(parsed)), totalPages)
    setDraft(String(clamped))
    if (clamped !== page) onPage(clamped)
  }

  if (totalPages <= 1) return null
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-gray-500">
      <span className="hidden sm:inline">Go to</span>
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={totalPages}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setDraft(String(page))
        }}
        aria-label={`Go to page, 1 to ${totalPages}`}
        className="w-14 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1.5 sm:py-1 text-sm tabular-nums"
      />
      <span className="whitespace-nowrap">/ {totalPages}</span>
    </label>
  )
}

/**
 * Pager shared by the ADP and pre-draft boards.
 *
 * `page` must be the already-clamped page the list is actually showing: every control here
 * steps from it, so a caller passing an unclamped value would leave Prev decrementing a page
 * number nothing is rendering.
 */
export default function PaginationBar({
  page,
  totalPages,
  total,
  pageSize,
  from,
  to,
  onPage,
  onPageSize,
  className = '',
  countLabel,
}: {
  page: number
  totalPages: number
  total: number
  pageSize: number
  from: number
  to: number
  onPage: (page: number) => void
  onPageSize: (size: PageSize) => void
  className?: string
  countLabel?: string
}) {
  if (total === 0) return null
  const label = countLabel ?? `${from}–${to} of ${total}`
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${className}`}>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        <span className="sm:hidden">{label}</span>
        <span className="hidden sm:inline">Showing {label}</span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-1.5 text-xs text-gray-500">
          Per page
          <select
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value) as PageSize)}
            className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1.5 sm:py-1 text-sm"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <JumpToPage page={page} totalPages={totalPages} onPage={onPage} />
        <button type="button" className={pagerButtonClass(false, page <= 1)} disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Prev
        </button>
        <div className="hidden sm:flex flex-wrap items-center gap-2">
          {pageItems(page, totalPages).map((item, i) =>
            item === 'ellipsis' ? (
              <span key={`e${i}`} className="px-1 text-xs text-gray-400">
                …
              </span>
            ) : (
              <button key={item} type="button" className={pagerButtonClass(item === page)} onClick={() => onPage(item)}>
                {item}
              </button>
            ),
          )}
        </div>
        <button
          type="button"
          className={pagerButtonClass(false, page >= totalPages)}
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  )
}

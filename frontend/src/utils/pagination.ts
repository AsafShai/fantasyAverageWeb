export const PAGE_SIZES = [25, 50, 100] as const
export type PageSize = (typeof PAGE_SIZES)[number]

export function resolvePageSize(value: number): PageSize {
  return (PAGE_SIZES as readonly number[]).includes(value) ? (value as PageSize) : 50
}

/** Page buttons around `current`, with ellipses standing in for the runs left out. */
export function pageItems(current: number, total: number): (number | 'ellipsis')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const wanted = new Set([1, total, current - 1, current, current + 1, current - 2, current + 2])
  const nums = [...wanted].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b)
  const out: (number | 'ellipsis')[] = []
  for (const n of nums) {
    const prev = out[out.length - 1]
    if (typeof prev === 'number' && n - prev > 1) out.push('ellipsis')
    out.push(n)
  }
  return out
}

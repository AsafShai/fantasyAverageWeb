import { useMemo, useState } from 'react'

export type SortDirection = 'asc' | 'desc'

export function useSort<T, K extends string>(items: T[], comparators: Record<K, (a: T, b: T) => number>) {
  const [sortKey, setSortKey] = useState<K | null>(null)
  const [direction, setDirection] = useState<SortDirection>('asc')

  const toggle = (key: K) => {
    if (key === sortKey) {
      setDirection(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setDirection('asc')
    }
  }

  const sorted = useMemo(() => {
    if (!sortKey) return items
    const comparator = comparators[sortKey]
    const copy = [...items].sort(comparator)
    return direction === 'asc' ? copy : copy.reverse()
  }, [items, sortKey, direction, comparators])

  return { sorted, sortKey, direction, toggle }
}

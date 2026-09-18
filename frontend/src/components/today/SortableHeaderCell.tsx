import type { SortDirection } from '../../hooks/useSort'

interface SortableHeaderCellProps {
  label: string
  active: boolean
  direction: SortDirection
  align?: 'left' | 'right'
  onSort: () => void
  className?: string
}

export default function SortableHeaderCell({
  label,
  active,
  direction,
  align = 'left',
  onSort,
  className = '',
}: SortableHeaderCellProps) {
  return (
    <th
      scope="col"
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`bg-white px-1.5 pb-1.5 text-[9.5px] font-bold uppercase tracking-wider text-gray-400 sm:px-2 dark:bg-gray-800 dark:text-gray-500 ${
        align === 'right' ? 'text-right' : 'text-left'
      } ${className}`}
    >
      <button
        type="button"
        onClick={onSort}
        className={`inline-flex items-center gap-0.5 uppercase tracking-wider hover:text-gray-600 dark:hover:text-gray-300 ${
          active ? 'text-gray-700 dark:text-gray-200' : ''
        }`}
      >
        {label}
        <span className="text-[8px] leading-none">
          {active ? (direction === 'asc' ? '▲' : '▼') : ''}
        </span>
      </button>
    </th>
  )
}

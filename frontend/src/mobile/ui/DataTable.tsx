import { Fragment, type CSSProperties, type ReactNode } from 'react'

export type SortDir = 'asc' | 'desc'
export interface SortState {
  key: string
  dir: SortDir
}

export interface Column<R> {
  key: string
  header: ReactNode
  /** Plain-text header for screen readers when `header` is an icon/abbrev. */
  headerLabel?: string
  cell: (row: R, index: number) => ReactNode
  align?: 'left' | 'right' | 'center'
  /** Pinned to the left while the table scrolls sideways (first column). */
  pinned?: boolean
  sortable?: boolean
  /** Sort direction on first tap; stats usually start high→low. */
  firstDir?: SortDir
  className?: string
  width?: number
}

interface DataTableProps<R> {
  columns: Column<R>[]
  rows: R[]
  rowKey: (row: R, index: number) => string
  /** Accessible table name, e.g. "Standings". */
  caption: string
  sort?: SortState | null
  onSortChange?: (sort: SortState) => void
  /** My-team row highlight. */
  isHighlighted?: (row: R) => boolean
  onRowClick?: (row: R) => void
  /**
   * Height cap. When set the table scrolls inside its box both ways and the
   * header stays visible; otherwise only sideways.
   */
  maxHeight?: number
  empty?: ReactNode
  className?: string
  /**
   * Extra content after a row, e.g. an expanded matchup panel. Return a whole
   * `<tr>` (span it with `colSpan={columns.length}`) or null.
   */
  renderAfterRow?: (row: R, index: number) => ReactNode
}

/**
 * Phone data table: sticky header, pinned first column, sortable headers,
 * my-team row highlight. Sorting is controlled; pages keep the sort in the
 * URL like today.
 */
export function DataTable<R>({
  columns,
  rows,
  rowKey,
  caption,
  sort,
  onSortChange,
  isHighlighted,
  onRowClick,
  maxHeight,
  empty = 'No rows',
  className = '',
  renderAfterRow,
}: DataTableProps<R>) {
  const boxStyle: CSSProperties | undefined = maxHeight ? { maxHeight, overflowY: 'auto' } : undefined
  const alignCls = (c: Column<R>) => (c.align === 'left' ? 'mr-l' : c.align === 'center' ? 'mr-c' : '')

  const toggle = (c: Column<R>) => {
    if (!onSortChange) return
    const first = c.firstDir ?? 'desc'
    if (sort?.key === c.key) onSortChange({ key: c.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' })
    else onSortChange({ key: c.key, dir: first })
  }

  return (
    <div className={`mr-tw ${className}`.trim()} style={boxStyle} tabIndex={0} role="region" aria-label={caption}>
      <table className="mr-t">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key
              const ariaSort = active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : c.sortable ? 'none' : undefined
              const cls = `${c.pinned ? 'mr-pin' : ''} ${alignCls(c)} ${c.className ?? ''}`.trim()
              return (
                <th key={c.key} scope="col" aria-sort={ariaSort} className={cls || undefined} style={c.width ? { minWidth: c.width } : undefined}>
                  {c.sortable && onSortChange ? (
                    <button type="button" className="mr-th-btn" onClick={() => toggle(c)} aria-label={c.headerLabel}>
                      {c.header}
                      {active && <span aria-hidden="true">{sort!.dir === 'asc' ? ' ▲' : ' ▼'}</span>}
                    </button>
                  ) : (
                    <span className="mr-th-label" aria-label={c.headerLabel}>{c.header}</span>
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="mr-empty" colSpan={columns.length}>{empty}</td>
            </tr>
          ) : (
            rows.map((r, i) => {
              const cls = `${isHighlighted?.(r) ? 'mr-me' : ''} ${onRowClick ? 'mr-click' : ''}`.trim()
              return (
                <Fragment key={rowKey(r, i)}>
                  <tr className={cls || undefined} onClick={onRowClick ? () => onRowClick(r) : undefined}>
                    {columns.map((c) => {
                      const ccls = `${c.pinned ? 'mr-pin' : ''} ${alignCls(c)} ${c.className ?? ''}`.trim()
                      return c.pinned ? (
                        <th key={c.key} scope="row" className={ccls}>
                          {c.cell(r, i)}
                        </th>
                      ) : (
                        <td key={c.key} className={ccls || undefined}>{c.cell(r, i)}</td>
                      )
                    })}
                  </tr>
                  {renderAfterRow?.(r, i)}
                </Fragment>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}

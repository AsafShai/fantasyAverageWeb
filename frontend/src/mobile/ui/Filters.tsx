import type { ReactNode } from 'react'
import { BottomSheet } from './BottomSheet'
import { Button } from './Button'
import { Chip, ChipRow } from './Chips'
import './filters.css'

/**
 * The Filters pattern shared by Players, Player Rankings, Trends and
 * Projections: a search box with a "Filters (n)" button, a row of the active
 * filters as chips, and a bottom sheet that holds exactly the page's filters.
 *
 * Open/close state comes from the page (`useSheetHistory('filters')`) so
 * browser back closes the sheet first.
 */

interface FilterSearchRowProps {
  search: string
  onSearchChange: (value: string) => void
  placeholder?: string
  /** Number of active filters, shown as a badge; hidden at 0. */
  activeCount: number
  onOpenFilters: () => void
  filtersOpen?: boolean
}

export function FilterSearchRow({
  search,
  onSearchChange,
  placeholder = 'Search players...',
  activeCount,
  onOpenFilters,
  filtersOpen = false,
}: FilterSearchRowProps) {
  return (
    <div className="mr-frow">
      <label className="mr-search">
        <span aria-hidden="true">🔍</span>
        <input
          type="search"
          value={search}
          placeholder={placeholder}
          aria-label={placeholder.replace(/[.…]+$/, '')}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onSearchChange('') }}
        />
        {search && (
          <button type="button" className="mr-search-clear" aria-label="Clear search" onClick={() => onSearchChange('')}>
            ×
          </button>
        )}
      </label>
      <Button
        size="sm"
        onClick={onOpenFilters}
        aria-haspopup="dialog"
        aria-expanded={filtersOpen}
        aria-label={activeCount > 0 ? `Filters (${activeCount} active)` : 'Filters'}
      >
        <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M3 5h14M6 10h8M8.5 15h3" />
        </svg>
        Filters
        {activeCount > 0 && (
          <span className="mr-count" aria-hidden="true">
            {activeCount}
          </span>
        )}
      </Button>
    </div>
  )
}

export interface ActiveFilter {
  key: string
  label: string
  /** Clears this one filter; without it the chip opens the sheet instead. */
  onRemove?: () => void
}

/**
 * Active filters as chips (× clears one). With nothing active, `idle` chips
 * describe the defaults ("All Teams", "All positions" …) and open the sheet.
 */
export function ActiveFilterChips({ active, idle = [], onOpen }: { active: ActiveFilter[]; idle?: string[]; onOpen: () => void }) {
  if (active.length === 0 && idle.length === 0) return null
  return (
    <ChipRow label="Active filters">
      {active.length > 0
        ? active.map((f) =>
            f.onRemove ? (
              <Chip key={f.key} selected removable onClick={f.onRemove} aria-label={`Remove filter ${f.label}`}>
                {f.label}
              </Chip>
            ) : (
              <Chip key={f.key} selected onClick={onOpen}>
                {f.label}
              </Chip>
            ),
          )
        : idle.map((label) => (
            <Chip key={label} selected onClick={onOpen}>
              {label}
            </Chip>
          ))}
    </ChipRow>
  )
}

interface FiltersSheetProps {
  open: boolean
  onClose: () => void
  onReset: () => void
  children: ReactNode
  title?: string
}

/** Bottom sheet with Reset in the heading and "Show results" at the bottom. */
export function FiltersSheet({ open, onClose, onReset, children, title = 'Filters' }: FiltersSheetProps) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={title}
      action={
        <button type="button" className="mr-link" onClick={onReset}>
          Reset
        </button>
      }
    >
      {children}
      <Button variant="primary" onClick={onClose} className="mr-sheet-cta">
        Show results
      </Button>
    </BottomSheet>
  )
}

/** One labelled group inside the Filters sheet. */
export function FilterGroup({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="mr-fgroup" role="group" aria-label={label}>
      <span className="mr-fgroup-label">
        {label}
        {hint && <span className="mr-fgroup-hint"> · {hint}</span>}
      </span>
      {children}
    </div>
  )
}

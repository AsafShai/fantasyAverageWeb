import { BottomSheet } from './BottomSheet'
import { useSheetHistory } from './useSheetHistory'

export interface SelectOption<T extends string> {
  value: T
  label: string
}

interface SelectSheetProps<T extends string> {
  /** Sheet heading and accessible name, e.g. "Team". */
  label: string
  options: readonly SelectOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Button text when it should differ from the selected option's label. */
  display?: string
  wide?: boolean
  /** Unique per page; used for the history entry so back closes the list. */
  id?: string
}

/**
 * Select button that opens a bottom-sheet list (replaces native <select> on
 * phones: bigger rows, one tap to pick, back button closes it).
 */
export function SelectSheet<T extends string>({ label, options, value, onChange, display, wide = false, id }: SelectSheetProps<T>) {
  const sheet = useSheetHistory(`select:${id ?? label}`)
  const current = options.find((o) => o.value === value)
  return (
    <>
      <button
        type="button"
        className={`mr-select ${wide ? 'mr-wide' : ''}`.trim()}
        aria-haspopup="listbox"
        aria-expanded={sheet.open}
        aria-label={`${label}: ${display ?? current?.label ?? ''}`}
        onClick={sheet.show}
      >
        <span className="mr-select-label">{display ?? current?.label ?? label}</span>
        <span className="mr-caret" aria-hidden="true">▾</span>
      </button>
      <BottomSheet
        open={sheet.open}
        onClose={sheet.hide}
        title={label}
        action={<button type="button" className="mr-link" onClick={sheet.hide}>Done</button>}
      >
        <div role="listbox" aria-label={label}>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className="mr-opt"
              onClick={() => {
                onChange(o.value)
                sheet.hide()
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      </BottomSheet>
    </>
  )
}

import { BottomSheet } from '../ui/BottomSheet'
import { useSheetHistory } from '../ui/useSheetHistory'

interface MultiSelectSheetProps {
  /** Plural noun: "teams", "categories". */
  label: string
  /** Sheet heading, e.g. "Teams". */
  title: string
  options: string[]
  selected: string[]
  onChange: (values: string[]) => void
  /** Unique per page; the sheet is a history entry so back closes it. */
  id: string
}

/**
 * Phone version of the Today page's multi-select filter: a select button
 * ("All teams" / one name / "3 teams") that opens a bottom-sheet checklist.
 */
export function MultiSelectSheet({ label, title, options, selected, onChange, id }: MultiSelectSheetProps) {
  const sheet = useSheetHistory(id)
  const buttonLabel =
    selected.length === 0 ? `All ${label}` : selected.length === 1 ? selected[0] : `${selected.length} ${label}`

  const toggle = (option: string) =>
    onChange(selected.includes(option) ? selected.filter((o) => o !== option) : [...selected, option])

  return (
    <>
      <button
        type="button"
        className={`mr-select ${selected.length ? 'mr-today-sel-on' : ''}`.trim()}
        aria-haspopup="dialog"
        aria-expanded={sheet.open}
        aria-label={`Filter ${label}: ${buttonLabel}`}
        onClick={sheet.show}
      >
        <span className="mr-select-label">{buttonLabel}</span>
        <span className="mr-caret" aria-hidden="true">▾</span>
      </button>
      <BottomSheet
        open={sheet.open}
        onClose={sheet.hide}
        title={title}
        action={
          <span className="mr-today-sheet-actions">
            {selected.length > 0 && (
              <button type="button" className="mr-link" onClick={() => onChange([])}>
                Clear
              </button>
            )}
            <button type="button" className="mr-link" onClick={sheet.hide}>
              Done
            </button>
          </span>
        }
      >
        <div role="group" aria-label={title}>
          {options.map((o) => (
            <label key={o} className="mr-opt mr-today-check">
              <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)} />
              <span>{o}</span>
            </label>
          ))}
        </div>
      </BottomSheet>
    </>
  )
}

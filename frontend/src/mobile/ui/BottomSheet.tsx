import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface BottomSheetProps {
  open: boolean
  onClose: () => void
  /** Accessible name; shown as the sheet heading unless `hideTitle`. */
  title: string
  hideTitle?: boolean
  /** Right side of the heading row (e.g. "Reset" or "Done"). */
  action?: ReactNode
  /** Grey sheet background (the ☰ menu); default white. */
  sunken?: boolean
  children: ReactNode
}

/**
 * Bottom sheet: scrim + rounded panel from the bottom with a grabber.
 * Closes on scrim tap and Escape, traps nothing but moves focus in and back
 * out, and locks page scroll while open. Browser back closing is handled by
 * useSheetHistory (so the URL/back wiring stays outside the visual piece).
 */
export function BottomSheet({ open, onClose, title, hideTitle = false, action, sunken = false, children }: BottomSheetProps) {
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    panel.current?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      previouslyFocused?.focus?.()
    }
  }, [open])

  if (!open) return null
  return createPortal(
    <div className="mr-root mr-sheet-layer" style={{ background: 'var(--mr-scrim)' }}>
      <button type="button" className="mr-sheet-scrim" aria-label={`Close ${title}`} tabIndex={-1} onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={hideTitle ? undefined : titleId}
        aria-label={hideTitle ? title : undefined}
        tabIndex={-1}
        className={`mr-sheet mr-noscroll ${sunken ? 'mr-sunken-sheet' : ''}`.trim()}
      >
        <div className="mr-grabber" aria-hidden="true" />
        {!hideTitle && (
          <div className="mr-card-head">
            <h2 id={titleId} className="mr-h2">{title}</h2>
            {action}
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  )
}

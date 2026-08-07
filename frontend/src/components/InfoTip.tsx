import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface InfoTipProps {
  title: string
  body: string
  formula?: string
  className?: string
}

const POPOVER_WIDTH = 200
const MARGIN = 8
const NARROW_BREAKPOINT = 640

function isNarrow() {
  return window.innerWidth < NARROW_BREAKPOINT
}

export default function InfoTip({ title, body, formula, className = '' }: InfoTipProps) {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const [narrow, setNarrow] = useState(false)
  const triggerRef = useRef<HTMLSpanElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const place = () => {
    setNarrow(isNarrow())
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const left = Math.min(
      Math.max(MARGIN, rect.right - POPOVER_WIDTH),
      window.innerWidth - POPOVER_WIDTH - MARGIN
    )
    setPos({ top: rect.bottom + 6, left })
  }

  useEffect(() => {
    if (!open) return
    place()
    const handleOutside = (e: Event) => {
      if (triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setPinned(false)
      }
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); setPinned(false) }
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('touchstart', handleOutside)
    document.addEventListener('keydown', handleEsc)
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('touchstart', handleOutside)
      document.removeEventListener('keydown', handleEsc)
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open])

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
  }, [])

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setOpen(o => {
      const next = !o
      setPinned(next)
      return next
    })
  }

  const handleMouseEnter = () => {
    if (isNarrow()) return
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setOpen(true)
  }

  const handleMouseLeave = () => {
    if (isNarrow() || pinned) return
    closeTimer.current = setTimeout(() => setOpen(false), 150)
  }

  return (
    <span
      ref={triggerRef}
      className={`relative inline-flex ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <span
        role="button"
        tabIndex={0}
        aria-label={`Explain: ${title}`}
        onClick={handleClick}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && handleClick(e as unknown as React.MouseEvent)}
        className="relative inline-flex items-center justify-center cursor-pointer select-none text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 before:content-[''] before:absolute before:-inset-3"
      >
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="8" cy="4.8" r="0.9" fill="currentColor" />
          <path d="M8 7.2V11.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </span>
      {open && createPortal(
        <>
          {narrow && (
            <div
              className="fixed inset-0 bg-black/40 z-[100]"
              onClick={() => { setOpen(false); setPinned(false) }}
            />
          )}
          <div
            role="tooltip"
            style={narrow ? undefined : { top: pos.top, left: pos.left, width: POPOVER_WIDTH }}
            onMouseEnter={() => { if (closeTimer.current) clearTimeout(closeTimer.current) }}
            onMouseLeave={handleMouseLeave}
            className={`normal-case font-normal z-[101] rounded-lg border border-gray-200 dark:border-gray-600
              bg-white dark:bg-gray-800 shadow-lg p-2.5
              ${narrow
                ? 'fixed left-3 right-3 bottom-3 w-auto shadow-2xl'
                : 'fixed'}`}
          >
            {narrow && (
              <button
                type="button"
                aria-label="Close"
                onClick={() => { setOpen(false); setPinned(false) }}
                className="absolute top-1.5 right-2 text-gray-400 dark:text-gray-500 text-base leading-none"
              >
                ✕
              </button>
            )}
            <div className="text-xs font-semibold text-gray-900 dark:text-gray-50 mb-0.5">{title}</div>
            <div className="text-[11px] leading-snug text-gray-600 dark:text-gray-300">{body}</div>
            {formula && (
              <div className="text-[10px] font-mono text-gray-400 dark:text-gray-400 mt-1">{formula}</div>
            )}
          </div>
        </>,
        document.body
      )}
    </span>
  )
}

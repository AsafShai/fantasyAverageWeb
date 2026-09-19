import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface MultiSelectFilterProps {
  label: string
  options: string[]
  selected: string[]
  onChange: (values: string[]) => void
}

export default function MultiSelectFilter({ label, options, selected, onChange }: MultiSelectFilterProps) {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const wrapperRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const positionMenu = () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    setMenuPos({ top: rect.bottom + window.scrollY + 4, left: rect.right + window.scrollX - 176 })
  }

  useEffect(() => {
    if (!open) return
    positionMenu()
    const handleClick = (e: MouseEvent) => {
      if (
        wrapperRef.current && !wrapperRef.current.contains(e.target as Node) &&
        menuRef.current && !menuRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    window.addEventListener('resize', positionMenu)
    window.addEventListener('scroll', positionMenu, true)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
      window.removeEventListener('resize', positionMenu)
      window.removeEventListener('scroll', positionMenu, true)
    }
  }, [open])

  const toggle = (option: string) => {
    if (selected.includes(option)) {
      onChange(selected.filter(o => o !== option))
    } else {
      onChange([...selected, option])
    }
  }

  const buttonLabel =
    selected.length === 0
      ? `All ${label}`
      : selected.length === 1
        ? selected[0]
        : `${selected.length} ${label}`

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 ${
          selected.length > 0
            ? 'border-blue-400 text-blue-700 dark:text-blue-300'
            : 'border-gray-300 text-gray-500 dark:border-gray-600 dark:text-gray-400'
        }`}
      >
        <span>{buttonLabel}</span>
        {selected.length > 0 && (
          <span
            role="button"
            tabIndex={0}
            aria-label={`Clear ${label} filter`}
            className="text-blue-400 hover:text-blue-600"
            onClick={e => {
              e.stopPropagation()
              onChange([])
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation()
                onChange([])
              }
            }}
          >
            ✕
          </span>
        )}
        <svg className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-multiselectable="true"
            style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
            className="z-50 max-h-60 w-44 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-700"
          >
            {options.map(option => (
              <label
                key={option}
                className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-blue-50 dark:text-gray-200 dark:hover:bg-gray-600"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(option)}
                  onChange={() => toggle(option)}
                  className="accent-blue-500"
                />
                {option}
              </label>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}

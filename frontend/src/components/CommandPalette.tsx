import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router'
import { useGlobalSearch, highlightMatch } from '../hooks/useGlobalSearch'
import type { SearchResult } from '../hooks/useGlobalSearch'

interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
}

const badgeClasses: Record<'fa' | 'out', string> = {
  fa: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200',
  out: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200',
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const hl = highlightMatch(text, query)
  if (!hl) return <>{text}</>
  return (
    <>
      {hl.before}
      <span className="bg-yellow-200 dark:bg-yellow-700/60 rounded-sm">{hl.match}</span>
      {hl.after}
    </>
  )
}

/**
 * One overlay for both desktop (centered, Ctrl/Cmd+K) and mobile (full-screen,
 * opened from the navbar search icon). Layout.tsx owns the open/close state
 * and the global Ctrl/Cmd+K listener so both nav variants can trigger it.
 */
const CommandPalette = ({ isOpen, onClose }: CommandPaletteProps) => {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  // Layout mounts the palette on every route, so the search data must not be
  // fetched until it is actually opened. Latched rather than tied to `isOpen`
  // directly: once opened, keep the subscription so reopening is instant.
  const [everOpened, setEverOpened] = useState(false)
  if (isOpen && !everOpened) setEverOpened(true)

  const { groups } = useGlobalSearch(query, everOpened)
  const flatResults = useMemo(() => groups.flatMap((g) => g.items), [groups])

  useEffect(() => {
    if (isOpen) {
      previouslyFocused.current = document.activeElement as HTMLElement | null
      setQuery('')
      setSelected(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    } else {
      previouslyFocused.current?.focus()
    }
  }, [isOpen])

  useEffect(() => {
    setSelected(0)
  }, [query])

  useEffect(() => {
    if (!isOpen) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelected((s) => Math.min(s + 1, flatResults.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelected((s) => Math.max(s - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const result = flatResults[selected]
        if (result?.path) {
          onClose()
          navigate(result.path)
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, flatResults, selected, onClose, navigate])

  if (!isOpen) return null

  const handleSelect = (result: SearchResult) => {
    if (!result.path) return
    onClose()
    navigate(result.path)
  }

  let rowIndex = -1

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center md:pt-16" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/40" />
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="relative flex h-full w-full flex-col overflow-hidden bg-white dark:bg-gray-900 md:h-auto md:max-h-[80vh] md:w-[520px] md:rounded-xl md:border md:border-gray-200 md:shadow-2xl md:dark:border-gray-700"
      >
        <div className="flex items-center gap-2 border-b border-gray-200 dark:border-gray-700 px-3 py-3">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0 text-gray-400 dark:text-gray-500">
            <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.6" />
            <path d="M14 14L18 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search players, teams, pages…"
            autoComplete="off"
            className="flex-1 bg-transparent text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-gray-300 px-1.5 py-0.5 text-[10px] text-gray-400 dark:border-gray-600 dark:text-gray-500"
          >
            esc
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-1 md:max-h-[300px] md:flex-none">
          {flatResults.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400 dark:text-gray-500">
              {query ? `No matches for "${query}"` : 'Start typing to search'}
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.group}>
                <div className="px-2 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                  {group.group}
                </div>
                {group.items.map((result) => {
                  rowIndex += 1
                  const isSelected = rowIndex === selected
                  return (
                    <div
                      key={result.key}
                      onMouseEnter={() => setSelected(rowIndex)}
                      onClick={() => handleSelect(result)}
                      className={`flex min-h-[44px] items-center gap-2 rounded-md px-2 py-2 md:min-h-0 ${
                        result.path ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
                      } ${isSelected ? 'bg-blue-50 dark:bg-blue-900/40' : ''}`}
                    >
                      <span className="w-5 shrink-0 text-center text-sm">{result.icon}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                          <HighlightedText text={result.title} query={query} />
                        </div>
                        <div className="truncate text-xs text-gray-500 dark:text-gray-400">{result.subtitle}</div>
                      </div>
                      {result.badge && (
                        <span
                          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${badgeClasses[result.badge.tone]}`}
                        >
                          {result.badge.label}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            ))
          )}
        </div>

        <div className="hidden gap-3 border-t border-gray-200 px-3 py-2 text-[10px] text-gray-400 dark:border-gray-700 dark:text-gray-500 md:flex">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  )
}

export default CommandPalette

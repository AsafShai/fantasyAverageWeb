import { useCallback, useState } from 'react'

const STORAGE_KEY = 'fw:player-sections'

function readAll(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

/**
 * Open/folded state of one player-page section. The viewer's last choice is
 * remembered in this browser (shared by the desktop and phone layouts); a
 * section they never touched uses `defaultOpen`.
 */
export function useSectionOpen(id: string, defaultOpen = true): [boolean, () => void] {
  const [open, setOpen] = useState(() => readAll()[id] ?? defaultOpen)
  const toggle = useCallback(() => {
    setOpen((was) => {
      const next = !was
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readAll(), [id]: next }))
      } catch {
        // storage blocked: the section still folds for this visit
      }
      return next
    })
  }, [id])
  return [open, toggle]
}

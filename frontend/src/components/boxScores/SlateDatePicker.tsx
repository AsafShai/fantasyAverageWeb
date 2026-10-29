import { useEffect, useId, useRef, useState } from 'react'

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function parseIso(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function inRange(iso: string, min?: string, max?: string): boolean {
  if (min && iso < min) return false
  if (max && iso > max) return false
  return true
}

function monthCells(year: number, month: number): string[] {
  const first = new Date(Date.UTC(year, month, 1))
  const lead = first.getUTCDay()
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const cells: string[] = []
  for (let index = 0; index < lead; index += 1) {
    cells.push(toIso(new Date(Date.UTC(year, month, 1 - (lead - index)))))
  }
  for (let day = 1; day <= count; day += 1) {
    cells.push(toIso(new Date(Date.UTC(year, month, day))))
  }
  while (cells.length % 7 !== 0) {
    const next = parseIso(cells[cells.length - 1])
    next.setUTCDate(next.getUTCDate() + 1)
    cells.push(toIso(next))
  }
  return cells
}

function monthCanOpen(year: number, month: number, min?: string, max?: string): boolean {
  const first = toIso(new Date(Date.UTC(year, month, 1)))
  const last = toIso(new Date(Date.UTC(year, month + 1, 0)))
  if (max && first > max) return false
  if (min && last < min) return false
  return true
}

function dayName(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parseIso(iso))
}

function monthName(year: number, month: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month, 1)))
}

export default function SlateDatePicker({
  date,
  label,
  min,
  max,
  onChange,
}: {
  date: string
  label: string
  min?: string
  max?: string
  onChange: (iso: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [visible, setVisible] = useState(() => parseIso(date))
  const root = useRef<HTMLDivElement>(null)
  const dialogId = useId()

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    function onPointer(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointer)
    }
  }, [open])

  const year = visible.getUTCFullYear()
  const month = visible.getUTCMonth()
  const cells = monthCells(year, month)
  const prevMonth = new Date(Date.UTC(year, month - 1, 1))
  const nextMonth = new Date(Date.UTC(year, month + 1, 1))

  function toggle() {
    setVisible(parseIso(date))
    setOpen(current => !current)
  }

  function pick(iso: string) {
    if (!inRange(iso, min, max)) return
    onChange(iso)
    setOpen(false)
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label="Choose a date"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        onClick={toggle}
        className="flex min-w-[12rem] items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-center text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
      >
        <svg className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        <span>{label}</span>
      </button>
      {open && (
        <div
          id={dialogId}
          role="dialog"
          aria-label="Choose a date"
          className="absolute left-1/2 top-full z-30 mt-2 w-[18.5rem] -translate-x-1/2 rounded-xl border border-gray-200 bg-white p-3 shadow-lg dark:border-gray-700 dark:bg-gray-900"
        >
          <div className="mb-2 flex items-center justify-between">
            <MonthButton
              label="Previous month"
              disabled={!monthCanOpen(prevMonth.getUTCFullYear(), prevMonth.getUTCMonth(), min, max)}
              onClick={() => setVisible(prevMonth)}
            >
              ‹
            </MonthButton>
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{monthName(year, month)}</p>
            <MonthButton
              label="Next month"
              disabled={!monthCanOpen(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth(), min, max)}
              onClick={() => setVisible(nextMonth)}
            >
              ›
            </MonthButton>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            {WEEKDAYS.map(day => <span key={day}>{day}</span>)}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {cells.map(iso => {
              const allowed = inRange(iso, min, max)
              const inMonth = parseIso(iso).getUTCMonth() === month
              const selected = iso === date
              return (
                <button
                  key={iso}
                  type="button"
                  disabled={!allowed}
                  aria-label={dayName(iso)}
                  aria-pressed={selected}
                  onClick={() => pick(iso)}
                  className={`h-8 rounded-md text-sm tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                    selected
                      ? 'bg-blue-600 font-semibold text-white'
                      : allowed
                        ? `${inMonth ? 'text-gray-800 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'} hover:bg-gray-100 dark:hover:bg-gray-800`
                        : 'cursor-not-allowed text-gray-300 opacity-35 dark:text-gray-500'
                  }`}
                >
                  {parseIso(iso).getUTCDate()}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function MonthButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid h-8 w-8 place-items-center rounded-md text-lg text-gray-700 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent dark:text-gray-200 dark:hover:bg-gray-800 dark:disabled:text-gray-600"
    >
      {children}
    </button>
  )
}

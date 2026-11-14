import { useState, useEffect } from 'react'

const VISIBLE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

interface DeadlineCountdownProps {
  deadline: string | null
}

const DeadlineCountdown = ({ deadline }: DeadlineCountdownProps) => {
  const deadlineMs = deadline ? new Date(deadline).getTime() : null
  // Tick the wall clock; the time left is derived from it, so a new deadline
  // shows the right value on its first render.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!deadlineMs) return
    const tick = () => setNow(Date.now())
    const first = setTimeout(tick, 0) // `now` may be stale if the deadline just appeared
    const id = setInterval(tick, 1000)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [deadlineMs])

  const timeLeft = deadlineMs ? deadlineMs - now : 0

  if (!deadlineMs || timeLeft <= 0 || timeLeft > VISIBLE_WINDOW_MS) return null

  const totalSeconds = Math.floor(timeLeft / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  const pad = (n: number) => String(n).padStart(2, '0')

  const label = new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(deadlineMs)

  return (
    <div className="bg-gradient-to-r from-red-600 to-orange-500 rounded-lg shadow-lg p-6 text-white">
      <div className="text-center mb-4">
        <h2 className="text-2xl font-bold tracking-wide">Trade Deadline</h2>
        <p className="text-red-100 mt-1">{label}</p>
      </div>
      <div className="flex justify-center gap-4">
        {[
          { value: days, label: 'Days' },
          { value: hours, label: 'Hours' },
          { value: minutes, label: 'Minutes' },
          { value: seconds, label: 'Seconds' },
        ].map(({ value, label }) => (
          <div key={label} className="flex flex-col items-center bg-white/20 rounded-xl px-5 py-4 min-w-[72px]">
            <span className="text-5xl font-bold tabular-nums leading-none">{pad(value)}</span>
            <span className="text-sm font-medium text-red-100 mt-2">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default DeadlineCountdown

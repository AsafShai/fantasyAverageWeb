import { useState, useEffect } from 'react'

interface DeadlineCountdownProps {
  deadline: string | null
}

const DeadlineCountdown = ({ deadline }: DeadlineCountdownProps) => {
  const deadlineMs = deadline ? new Date(deadline).getTime() : null
  const [timeLeft, setTimeLeft] = useState(() => (deadlineMs ? deadlineMs - Date.now() : 0))

  useEffect(() => {
    if (!deadlineMs) return
    setTimeLeft(deadlineMs - Date.now())
    const id = setInterval(() => {
      setTimeLeft(deadlineMs - Date.now())
    }, 1000)
    return () => clearInterval(id)
  }, [deadlineMs])

  if (!deadlineMs || timeLeft <= 0) return null

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

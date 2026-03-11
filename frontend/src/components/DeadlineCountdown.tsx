import { useState, useEffect } from 'react'

const DEADLINE = new Date('2026-03-16T10:00:00Z') // 12:00 Israel Standard Time (UTC+2)

const DeadlineCountdown = () => {
  const [timeLeft, setTimeLeft] = useState(() => DEADLINE.getTime() - Date.now())

  useEffect(() => {
    const id = setInterval(() => {
      setTimeLeft(DEADLINE.getTime() - Date.now())
    }, 1000)
    return () => clearInterval(id)
  }, [])

  if (timeLeft <= 0) return null

  const totalSeconds = Math.floor(timeLeft / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  const pad = (n: number) => String(n).padStart(2, '0')

  return (
    <div className="bg-gradient-to-r from-red-600 to-orange-500 rounded-lg shadow-lg p-6 text-white">
      <div className="text-center mb-4">
        <h2 className="text-2xl font-bold tracking-wide">Trade Deadline</h2>
        <p className="text-red-100 mt-1">16/3 12:00</p>
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

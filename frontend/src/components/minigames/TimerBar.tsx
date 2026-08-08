import { useEffect, useRef, useState } from 'react'

/** Draining progress bar; calls onTimeout once when time hits 0. */
export default function TimerBar({
  totalSeconds,
  running,
  resetKey,
  onTimeout,
}: {
  totalSeconds: number
  running: boolean
  resetKey: string | number
  onTimeout: () => void
}) {
  const [remainingMs, setRemainingMs] = useState(totalSeconds * 1000)
  const onTimeoutRef = useRef(onTimeout)
  onTimeoutRef.current = onTimeout

  useEffect(() => {
    const total = totalSeconds * 1000
    setRemainingMs(total)
    if (!running) return

    const deadline = performance.now() + total
    let frame = 0
    let fired = false

    const tick = (now: number) => {
      const left = Math.max(0, deadline - now)
      setRemainingMs(left)
      if (left <= 0) {
        if (!fired) {
          fired = true
          onTimeoutRef.current()
        }
        return
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [running, resetKey, totalSeconds])

  const pct = Math.max(0, Math.min(100, (remainingMs / (totalSeconds * 1000)) * 100))
  const secs = Math.ceil(remainingMs / 1000)
  const urgent = secs <= 10
  const warn = secs <= 20

  return (
    <div className="w-full">
      <div className="flex justify-between text-xs mb-1">
        <span className={urgent ? 'text-red-600 font-semibold' : 'text-gray-500'}>Time</span>
        <span
          className={
            urgent
              ? 'text-red-600 font-bold'
              : warn
                ? 'text-amber-600 font-semibold'
                : 'text-gray-700 dark:text-gray-300'
          }
        >
          {secs}s
        </span>
      </div>
      <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
        <div
          className={`h-full ${urgent ? 'bg-red-500' : warn ? 'bg-amber-500' : 'bg-blue-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

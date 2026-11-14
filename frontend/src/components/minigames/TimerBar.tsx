import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/** Draining progress bar; calls onTimeout once when time hits 0. */
export default function TimerBar({
  totalSeconds,
  running,
  resetKey,
  onTimeout,
  prominent = false,
}: {
  totalSeconds: number
  running: boolean
  resetKey: string | number
  onTimeout: () => void
  /** Larger bar and type — e.g. sticky header on phone for photo games. */
  prominent?: boolean
}) {
  const totalMs = totalSeconds * 1000
  const [remainingMs, setRemainingMs] = useState(totalMs)
  const onTimeoutRef = useRef(onTimeout)
  useLayoutEffect(() => {
    onTimeoutRef.current = onTimeout
  })

  // Refill the bar when a new round starts (adjusted during render).
  const [roundFor, setRoundFor] = useState({ resetKey, totalMs })
  if (roundFor.resetKey !== resetKey || roundFor.totalMs !== totalMs) {
    setRoundFor({ resetKey, totalMs })
    setRemainingMs(totalMs)
  }

  useEffect(() => {
    if (!running) return

    const startedAt = performance.now()
    let fired = false
    let frame = 0

    const tick = (now: number) => {
      const left = Math.max(0, totalMs - (now - startedAt))
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
  }, [running, resetKey, totalMs])

  const pct = Math.max(0, Math.min(100, (remainingMs / totalMs) * 100))
  const secs = Math.ceil(remainingMs / 1000)
  const urgent = secs <= 10
  const warn = secs <= 20

  const fillColor = urgent ? 'bg-red-500' : warn ? 'bg-amber-500' : 'bg-blue-500'

  return (
    <div className={`w-full ${prominent ? 'mg-timer-prominent' : ''}`}>
      <div className={`flex justify-between mb-1 ${prominent ? 'text-sm' : 'text-xs'}`}>
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
      <div
        className={`rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden ${prominent ? 'h-3' : 'h-2'}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={totalSeconds}
        aria-valuenow={secs}
      >
        <div
          className={`h-full w-full origin-left ${fillColor}`}
          style={{ transform: `scaleX(${pct / 100})` }}
        />
      </div>
    </div>
  )
}

/** When a player on waivers clears (ESPN's waiverProcessDate), in the viewer's local time. */

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

export interface WaiverClear {
  /** "today", "tomorrow" or a weekday ("Mon"), by the viewer's own calendar. ESPN's
   *  run starts at a fixed time but finishes at a different minute each night, so
   *  only the day is shown. */
  when: string
  /** Tooltip: "Clears waivers on Sun, Nov 22". */
  full: string
  /** Under 24 hours to go (or due and not processed yet). */
  soon: boolean
}

export function waiverClear(iso: string | null | undefined, now: Date = new Date()): WaiverClear | null {
  if (!iso) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  const msLeft = at.getTime() - now.getTime()
  const date = at.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const when =
    dayKey(at) === dayKey(now)
      ? 'today'
      : dayKey(at) === dayKey(tomorrow)
        ? 'tomorrow'
        : at.toLocaleDateString('en-US', { weekday: 'short' })
  return { when, full: `Clears waivers on ${date}`, soon: msLeft < 24 * 3600 * 1000 }
}

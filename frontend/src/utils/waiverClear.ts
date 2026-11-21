/** When a player on waivers clears (ESPN's waiverProcessDate), in league time (ET). */

const ET = 'America/New_York'

const dayKey = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: ET })

export interface WaiverClear {
  /** "today", "tomorrow" or a weekday ("Mon"). ESPN's run starts at a fixed time but
   *  finishes at a different minute each night, so only the day is shown. */
  when: string
  /** Tooltip: "Clears waivers overnight into Sun, Nov 22". */
  full: string
  /** Under 24 hours to go (or due and not processed yet). */
  soon: boolean
}

export function waiverClear(iso: string | null | undefined, now: Date = new Date()): WaiverClear | null {
  if (!iso) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  const msLeft = at.getTime() - now.getTime()
  const date = at.toLocaleDateString('en-US', { timeZone: ET, weekday: 'short', month: 'short', day: 'numeric' })
  const full = `Clears waivers overnight into ${date}`
  const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000)
  const when =
    dayKey(at) === dayKey(now)
      ? 'today'
      : dayKey(at) === dayKey(tomorrow)
        ? 'tomorrow'
        : at.toLocaleDateString('en-US', { timeZone: ET, weekday: 'short' })
  return { when, full, soon: msLeft < 24 * 3600 * 1000 }
}

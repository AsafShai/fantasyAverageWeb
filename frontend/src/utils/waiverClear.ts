/** When a player on waivers clears (ESPN's waiverProcessDate), in league time (ET). */

const ET = 'America/New_York'

const dayKey = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: ET })

function hourLabel(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: ET, hour: 'numeric', minute: '2-digit' }).format(d)
  return parts.replace(':00', '') // "3:00 AM" -> "3 AM", keeps "3:30 AM"
}

export interface WaiverClear {
  /** "today 3 AM", "tomorrow 3 AM", "Mon 3 AM" or "any minute" once the time has passed. */
  when: string
  /** Full sentence for a tooltip: "Clears waivers Sun, Nov 22 at 3 AM ET". */
  full: string
  /** Under 24 hours to go (or already due). */
  soon: boolean
}

export function waiverClear(iso: string | null | undefined, now: Date = new Date()): WaiverClear | null {
  if (!iso) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  const msLeft = at.getTime() - now.getTime()
  const date = at.toLocaleDateString('en-US', { timeZone: ET, weekday: 'short', month: 'short', day: 'numeric' })
  const full = `Clears waivers ${date} at ${hourLabel(at)} ET`
  if (msLeft <= 0) return { when: 'any minute', full: `${full} (processing now)`, soon: true }

  const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000)
  const day =
    dayKey(at) === dayKey(now)
      ? 'today'
      : dayKey(at) === dayKey(tomorrow)
        ? 'tomorrow'
        : at.toLocaleDateString('en-US', { timeZone: ET, weekday: 'short' })
  return { when: `${day} ${hourLabel(at)}`, full, soon: msLeft < 24 * 3600 * 1000 }
}

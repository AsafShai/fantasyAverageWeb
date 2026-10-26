/** Tip time in the viewer's time zone. Final and live labels stay as reported. */
export function gameClockLabel(status: string, statusDetail: string, startTime: string): string {
  if (status === 'scheduled') {
    return formatLocalTip(startTime) || statusDetail || 'Upcoming'
  }
  return statusDetail || status
}

/** Clock only, in the viewer's time zone. */
export function localClock(iso: string, timeZone?: string): string | null {
  const date = new Date(iso)
  if (!iso || Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('en-US', {
    ...(timeZone ? { timeZone } : {}),
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

/** Local clock for a tip. Adds the local date when it is not the Eastern game day. */
export function formatLocalTip(iso: string, timeZone?: string): string | null {
  const date = new Date(iso)
  if (!iso || Number.isNaN(date.getTime())) return null
  const zone = timeZone ? { timeZone } : {}
  const time = localClock(iso, timeZone)
  const easternDay = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
  const localDay = new Intl.DateTimeFormat('en-CA', {
    ...zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
  if (easternDay === localDay) return time
  const when = new Intl.DateTimeFormat('en-US', {
    ...zone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date)
  return `${when}, ${time}`
}

export function toLocalIso(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function daysBetween(startIso: string, endIso: string): number {
  const [startYear, startMonth, startDay] = startIso.split('-').map(Number)
  const [endYear, endMonth, endDay] = endIso.split('-').map(Number)
  const start = new Date(startYear, startMonth - 1, startDay)
  const end = new Date(endYear, endMonth - 1, endDay)
  const startUtcMs = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())
  const endUtcMs = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate())
  return Math.round((endUtcMs - startUtcMs) / 86400000)
}

export function getDateNDaysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return toLocalIso(d)
}

export const todayIso = () => toLocalIso(new Date())

export const formatShort = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

export function validateDateRange(
  start: string,
  end: string,
  seasonStart?: string,
  today: string = todayIso()
): string | null {
  if (!start || !end) return null
  if (seasonStart && start < seasonStart) {
    return `Start date cannot be before season start (${seasonStart})`
  }
  if (end > today) {
    return 'End date cannot be after today'
  }
  if (start >= end) {
    return 'Start date must be before end date'
  }
  return null
}

const todayIso = () => new Date().toISOString().split('T')[0]

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

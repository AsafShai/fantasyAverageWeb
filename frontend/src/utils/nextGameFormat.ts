// Formatting for the next-game projection line (profile card, phone and desktop).

export function fmtStat(n: number, integer: boolean): string {
  return integer ? String(Math.round(n)) : n.toFixed(1)
}

export function pctCell(pctVal: number, made: number, att: number, integer: boolean): { pct: string; frac: string } {
  if (!(att > 0)) return { pct: '—', frac: '' }
  if (integer) {
    const m = Math.round(made), a = Math.round(att)
    return { pct: a > 0 ? `${Math.round((m / a) * 100)}%` : '—', frac: `${m}/${a}` }
  }
  return { pct: `${(pctVal * 100).toFixed(1)}%`, frac: `${made.toFixed(1)}/${att.toFixed(1)}` }
}

export function formatGameDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

export function relativeDay(iso: string): string | null {
  const d = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(d.getTime())) return null
  const today = new Date()
  today.setHours(12, 0, 0, 0)
  const days = Math.round((d.getTime() - today.getTime()) / 86400000)
  if (days < 0) return null
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `in ${days} days`
}

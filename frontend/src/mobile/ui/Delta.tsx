interface DeltaProps {
  /** Change since the previous period. Positive = better. */
  value: number | null | undefined
  /**
   * rank   ▲3 / ▼2 (rank or points moves; 0 renders nothing)
   * total  same arrows, but 0 renders a grey "–"
   * gp     grey "+n" games played
   */
  kind?: 'rank' | 'total' | 'gp'
  /** Decimals for non-integer changes. */
  digits?: number
}

/**
 * Small bold ▲ green / ▼ red next to a number. Only the Rankings view shows
 * deltas; the Standings view stays plain, so pages simply don't render this.
 */
export function Delta({ value, kind = 'rank', digits = 0 }: DeltaProps) {
  if (value === null || value === undefined || Number.isNaN(value)) return null
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(digits || 1))
  if (kind === 'gp') {
    if (value === 0) return null
    return <span className="mr-delta mr-delta-gp">+{fmt(value)}</span>
  }
  if (value === 0) {
    return kind === 'total' ? <span className="mr-delta mr-delta-same" aria-label="no change">–</span> : null
  }
  const up = value > 0
  return (
    <span className={`mr-delta ${up ? 'mr-delta-up' : 'mr-delta-down'}`} aria-label={`${up ? 'up' : 'down'} ${fmt(Math.abs(value))}`}>
      {up ? '▲' : '▼'}
      {fmt(Math.abs(value))}
    </span>
  )
}

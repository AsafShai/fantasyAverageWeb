interface DeltaProps {
  /** Change since the previous period. Positive = better. */
  value: number | null | undefined
  /**
   * rank   ▲3 / ▼2 (rank or points moves; 0 renders nothing)
   * total  same arrows, but 0 renders a grey "–"
   * gp     grey "+n" games played
   * stat   grey "+n" / "−n" of a raw stat added (Totals standings); 0 renders nothing
   */
  kind?: 'rank' | 'total' | 'gp' | 'stat'
  /** Decimals for non-integer changes. */
  digits?: number
}

/**
 * Small bold ▲ green / ▼ red next to a number (roto moves), or a grey "+n"
 * for games played and, in Totals standings, raw stats added.
 */
export function Delta({ value, kind = 'rank', digits = 0 }: DeltaProps) {
  if (value === null || value === undefined || Number.isNaN(value)) return null
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(digits || 1))
  if (kind === 'gp') {
    if (value === 0) return null
    return <span className="mr-delta mr-delta-gp">+{fmt(value)}</span>
  }
  if (kind === 'stat') {
    if (value === 0) return null
    return <span className="mr-delta mr-delta-gp">{value > 0 ? '+' : '−'}{fmt(Math.abs(value))}</span>
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

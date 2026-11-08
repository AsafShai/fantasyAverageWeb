import { statusKey } from './statusKey'

const SHORT_STATUS: Record<string, string> = {
  DOUBTFUL: 'D',
  QUESTIONABLE: 'Q',
  DAY_TO_DAY: 'DTD',
  PROBABLE: 'P',
  SUSPENSION: 'SUSP',
}

const STATUS_CLASS: Record<string, string> = {
  DOUBTFUL: 'mr-pill-doubt',
  QUESTIONABLE: 'mr-pill-quest',
  DAY_TO_DAY: 'mr-pill-quest',
  PROBABLE: 'mr-pill-prob',
  SUSPENSION: 'mr-pill-out',
}

/** Injury status next to a name: 🩹 for Out, a short colored pill otherwise (mobile roster + hints). */
export function InjuryMark({ status }: { status?: string | null }) {
  if (!status) return null
  const key = statusKey(status)
  if (key === 'ACTIVE' || key === 'AVAILABLE') return null
  if (key === 'OUT' || key === 'INJURY_RESERVE') {
    return (
      <span className="mr-tm-inj" title={status} role="img" aria-label={status}>
        🩹
      </span>
    )
  }
  return (
    <span className={`mr-pill mr-square ${STATUS_CLASS[key] ?? 'mr-pill-bench'}`} title={status} aria-label={status}>
      {SHORT_STATUS[key] ?? status}
    </span>
  )
}

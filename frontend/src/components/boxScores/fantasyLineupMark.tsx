import { FANTASY_LINEUP_DOT_CLASS, FANTASY_LINEUP_LABEL, type FantasyLineupState } from './fantasyLineup'

export function FantasyLineupMark({ state, compact = false }: { state: FantasyLineupState; compact?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 font-normal text-gray-500 dark:text-gray-400"
      title={FANTASY_LINEUP_LABEL[state]}
      aria-label={FANTASY_LINEUP_LABEL[state]}>
      <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${FANTASY_LINEUP_DOT_CLASS[state]}`} aria-hidden />
      {!compact && <span className="text-[10px] max-sm:sr-only">{FANTASY_LINEUP_LABEL[state]}</span>}
    </span>
  )
}

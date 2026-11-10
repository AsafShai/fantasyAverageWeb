import type { FantasyNightContext, SlatePlayerValue } from '../../types/boxScore'

export type FantasyLineupState = 'started' | 'bench' | 'ir'

export function fantasyLineupState(ctx: FantasyNightContext | undefined | null): FantasyLineupState | null {
  if (!ctx?.fantasy_team) return null
  if (ctx.started === null || ctx.started === undefined) return null
  if (ctx.started) return 'started'
  if (ctx.lineup_slot === 'IR') return 'ir'
  return 'bench'
}

/** Shared with Boom or Bust and share cards — sky = active fantasy slot (not on-court green). */
export const FANTASY_LINEUP_DOT_CLASS: Record<FantasyLineupState, string> = {
  started: 'bg-sky-400 dark:bg-sky-500',
  bench: 'bg-gray-400 dark:bg-gray-500',
  ir: 'bg-amber-400',
}

export const FANTASY_LINEUP_LABEL: Record<FantasyLineupState, string> = {
  started: 'active lineup',
  bench: 'bench',
  ir: 'IR',
}

export function resolveFantasyContext(
  playerId: string | number | null | undefined,
  values?: Map<string, SlatePlayerValue>,
  fantasyPlayers?: Record<string, FantasyNightContext>,
): FantasyNightContext | undefined {
  if (playerId == null || playerId === '') return undefined
  const key = String(playerId)
  return values?.get(key) ?? fantasyPlayers?.[key]
}

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

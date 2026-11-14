import type { FantasyNightContext, SlatePlayerValue } from '../../types/boxScore'

export type FantasyLineupState = 'started' | 'bench' | 'ir'

export function fantasyLineupState(ctx: FantasyNightContext | undefined | null): FantasyLineupState | null {
  if (!ctx?.fantasy_team) return null
  if (ctx.started === null || ctx.started === undefined) return null
  if (ctx.started) return 'started'
  if (ctx.lineup_slot === 'IR') return 'ir'
  return 'bench'
}

/** NBA floor (live box, Lines of the night). */
export const ON_COURT_DOT_CLASS = 'bg-sky-400 dark:bg-sky-500'

export const ON_COURT_MARK_TEXT_CLASS = 'text-sky-600 dark:text-sky-400'

/** Fantasy active slot (Boom or Bust, share cards, box score fantasy column). */
export const FANTASY_LINEUP_DOT_CLASS: Record<FantasyLineupState, string> = {
  started: 'bg-emerald-500',
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

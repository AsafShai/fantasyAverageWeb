/**
 * Per-slot pace maths for the Slot Usage table.
 *
 * The `estimated` blend mirrors SlotGamesEstimator.estimate() in
 * backend/app/services/slot_games_estimator.py — keep the two in sync.
 *
 * Everything here is expressed *per slot*: UTIL is three roster slots, so its
 * raw games-used is divided by 3 and compared against the same 82-game ceiling
 * as every other slot.
 */

export const SLOT_NAMES = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL'] as const
export type SlotName = (typeof SLOT_NAMES)[number]

/** How many roster slots each column represents. */
export const SLOT_MULTIPLICITY: Record<SlotName, number> = {
  PG: 1, SG: 1, SF: 1, PF: 1, C: 1, G: 1, F: 1, UTIL: 3,
}

/**
 * Season allowance per column. UTIL is three slots plus two spare games (3 * 82 + 2):
 * an ESPN quirk lets you leave one UTIL open on the last game week and still play all
 * three afterwards.
 */
export const SLOT_CAPS: Record<SlotName, number> = {
  PG: 82, SG: 82, SF: 82, PF: 82, C: 82, G: 82, F: 82, UTIL: 248,
}

/** A single slot can be filled on at most 82 NBA game days. */
export const GAMES_PER_SLOT = 82

/** The cap a single slot of this column may reach — 82 everywhere, 82.67 for UTIL. */
export function slotCeiling(slot: SlotName): number {
  return SLOT_CAPS[slot] / SLOT_MULTIPLICITY[slot]
}

/** Below this NBA pace the season is too young for any of these signals to mean anything. */
export const MIN_PACE_FOR_COLOR = 10

/**
 * Estimate bands, per slot: at 82 you finish the season, under 78 you have lost real games.
 * Scaled by the column's slot count before comparing, so UTIL is judged against 3 × these.
 */
export const EST_GREEN = 82
export const EST_YELLOW = 80
export const EST_ORANGE = 78

/** Rate bands, as absolute drift away from 1.0 — in either direction. */
export const RATE_GREEN = 0.05
export const RATE_YELLOW = 0.1
export const RATE_ORANGE = 0.15

export type SlotTone = 'neutral' | 'green' | 'yellow' | 'orange' | 'red'

export interface SlotProjection {
  /** Games used, normalised to a single slot (UTIL divided by 3). */
  used: number
  /** Games used across the whole column — for UTIL this is all three slots. */
  usedTotal: number
  /** Games used per NBA game elapsed. 1.0 is exactly on pace. */
  rate: number | null
  /** Most games this slot can still finish on, per slot. */
  maxGames: number | null
  /** Most games the whole column can still finish on — UTIL counts all three slots, out of 248. */
  maxGamesTotal: number | null
  /**
   * Blended season-end projection for the whole column — UTIL counts all three slots,
   * out of 248. This is the direct mirror of proj_<slot> in the backend estimator.
   */
  estimated: number | null
  /**
   * The projection as a whole number of games, which is what it really is — you either
   * play a game in the slot or you do not. Both the display and the colour use this, so
   * a projection of 81.7 reads 82 and grades as 82.
   */
  estimatedRounded: number | null
  /** The same projection divided back down to a single slot. */
  estimatedPerSlot: number | null
}

export interface PaceContext {
  avgPace: number | null | undefined
  gameDaysLeft: number | null | undefined
}

/** Colours are meaningless in the first couple of weeks — everything is 0/82 then. */
export function canColor({ avgPace }: PaceContext): boolean {
  return typeof avgPace === 'number' && avgPace > MIN_PACE_FOR_COLOR
}

export function projectSlot(
  gamesUsed: number,
  slot: SlotName,
  { avgPace, gameDaysLeft }: PaceContext,
): SlotProjection {
  const multiplicity = SLOT_MULTIPLICITY[slot]
  const cap = SLOT_CAPS[slot]
  const used = gamesUsed / multiplicity
  const ceiling = slotCeiling(slot)

  if (typeof avgPace !== 'number' || avgPace <= 0) {
    return {
      used,
      usedTotal: gamesUsed,
      rate: null,
      maxGames: null,
      maxGamesTotal: null,
      estimated: null,
      estimatedRounded: null,
      estimatedPerSlot: null,
    }
  }

  const rate = used / avgPace

  const daysLeft = typeof gameDaysLeft === 'number' ? gameDaysLeft : null
  const maxGames = daysLeft === null ? null : Math.min(used + daysLeft, ceiling)
  // Every remaining game day can fill each slot in the column, so UTIL gains three a day.
  const maxGamesTotal =
    daysLeft === null ? null : Math.min(gamesUsed + daysLeft * multiplicity, SLOT_CAPS[slot])

  // Worked on the column total against the column cap, exactly as the backend estimator does.
  // Method 1 — extrapolate the current rate over a full 82-game season.
  const m1 = Math.min(gamesUsed * (GAMES_PER_SLOT / avgPace), cap)
  // Method 2 — apply the current rate to the game days actually left.
  const m2 = daysLeft === null ? null : Math.min(gamesUsed + (gamesUsed / avgPace) * daysLeft, cap)

  // Method 2 takes over as the season progresses.
  const w2 = avgPace / GAMES_PER_SLOT
  const estimated = m2 === null ? m1 : (1 - w2) * m1 + w2 * m2

  return {
    used,
    usedTotal: gamesUsed,
    rate,
    maxGames,
    maxGamesTotal,
    estimated,
    estimatedRounded: Math.round(estimated),
    estimatedPerSlot: estimated / multiplicity,
  }
}

/**
 * Rate is graded on how far off pace the slot is, in either direction — burning games
 * too fast is as much of a problem as falling behind. The arrow carries the direction.
 */
export function rateTone(rate: number | null, ctx: PaceContext): SlotTone {
  if (rate === null || !canColor(ctx)) return 'neutral'
  const drift = Math.abs(rate - 1)
  if (drift < RATE_GREEN) return 'green'
  if (drift < RATE_YELLOW) return 'yellow'
  if (drift < RATE_ORANGE) return 'orange'
  return 'red'
}

/**
 * How many games the slot is off the NBA rate, signed: 69 used against a rate of 69.3
 * reads −0.3. The colour still comes from rateTone, which grades the gap in percent.
 */
export function formatRateDelta(used: number, avgPace: number | null | undefined): string {
  if (typeof avgPace !== 'number' || !Number.isFinite(avgPace)) return '-'
  const delta = used - avgPace
  if (Math.abs(delta) < 0.05) return 'on pace'
  return `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)}`
}

/**
 * Binary: either the column can still be filled out completely, or it cannot.
 * Compared against the whole column's cap, so UTIL is judged against 248 rather than 82.
 */
export function maxTone(maxGamesTotal: number | null, slot: SlotName, ctx: PaceContext): SlotTone {
  if (maxGamesTotal === null || !canColor(ctx)) return 'neutral'
  return maxGamesTotal < SLOT_CAPS[slot] ? 'red' : 'green'
}

/** Takes the column total, so UTIL is graded against 3 × each band. */
export function estimatedTone(estimated: number | null, slot: SlotName, ctx: PaceContext): SlotTone {
  if (estimated === null || !canColor(ctx)) return 'neutral'
  const slots = SLOT_MULTIPLICITY[slot]
  if (estimated >= EST_GREEN * slots) return 'green'
  if (estimated >= EST_YELLOW * slots) return 'yellow'
  if (estimated >= EST_ORANGE * slots) return 'orange'
  return 'red'
}

export const TONE_CLASS: Record<SlotTone, string> = {
  neutral: 'bg-gray-100 text-gray-600',
  green: 'bg-green-100 text-green-800',
  yellow: 'bg-yellow-100 text-yellow-800',
  orange: 'bg-orange-100 text-orange-800',
  red: 'bg-red-100 text-red-800',
}


/**
 * The cap as a denominator. UTIL is written (246+2) rather than 248 so the two spare
 * games stay visible as the oddity they are, instead of hiding inside a round total.
 */
export function formatCap(slot: SlotName): string {
  const slots = SLOT_MULTIPLICITY[slot]
  if (slots === 1) return String(SLOT_CAPS[slot])
  const base = GAMES_PER_SLOT * slots
  const spare = SLOT_CAPS[slot] - base
  return spare === 0 ? String(base) : `(${base}+${spare})`
}

/** Trims a trailing `.0` so whole numbers stay readable in a dense table. */
export function formatSlotNumber(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return '-'
  return Number.isInteger(value) ? String(value) : value.toFixed(digits)
}
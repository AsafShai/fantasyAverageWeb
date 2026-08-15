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

/** A single slot can be filled on at most 82 NBA game days. */
export const GAMES_PER_SLOT = 82

/**
 * Season allowance per column. UTIL is three slots plus two spare games (3 * 82 + 2):
 * an ESPN quirk lets you leave one UTIL open on the last game week and still play all
 * three afterwards.
 */
export const SLOT_CAPS: Record<SlotName, number> = {
  PG: 82, SG: 82, SF: 82, PF: 82, C: 82, G: 82, F: 82, UTIL: 248,
}

/** The cap a single slot of this column may reach — 82 everywhere, 82.67 for UTIL. */
export function slotCeiling(slot: SlotName): number {
  return SLOT_CAPS[slot] / SLOT_MULTIPLICITY[slot]
}

/** Below this NBA pace the season is too young for any of these signals to mean anything. */
export const MIN_PACE_FOR_COLOR = 10

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

  // The ceiling needs no pace: it is games already banked plus one per remaining game day.
  // With the remaining days still unknown, the whole cap is in principle reachable.
  const daysLeft = typeof gameDaysLeft === 'number' ? gameDaysLeft : null
  const maxGames = daysLeft === null ? ceiling : Math.min(used + daysLeft, ceiling)
  // Every remaining game day can fill each slot in the column, so UTIL gains three a day.
  const maxGamesTotal =
    daysLeft === null ? cap : Math.min(gamesUsed + daysLeft * multiplicity, cap)

  if (typeof avgPace !== 'number' || avgPace <= 0) {
    return {
      used,
      usedTotal: gamesUsed,
      rate: null,
      maxGames,
      maxGamesTotal,
      estimated: null,
      estimatedRounded: null,
      estimatedPerSlot: null,
    }
  }

  const rate = used / avgPace

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
 * What the row has to say, if anything. A slot on pace, projecting a full season and
 * with nothing lost produces three nulls, and the table prints nothing for it — colour
 * and words only ever appear together, on the exceptions.
 *
 * `behindPace` is per slot so UTIL is comparable with the rest, and flags any gap once it
 * rounds to a whole game; `short` and `lost` are whole-column counts, because a lost game
 * is a lost game whichever slot it belonged to.
 */
export interface SlotStatus {
  /** Games this slot is behind the NBA rate, per slot. Null when at or ahead of pace. */
  behindPace: number | null
  /** Games the projection falls short of the column cap. Null when it reaches it. */
  short: number | null
  /** Games the column can no longer play, whatever happens now. Null when none. */
  lost: number | null
}

export function slotStatus(
  projection: SlotProjection,
  slot: SlotName,
  ctx: PaceContext,
): SlotStatus {
  if (!canColor(ctx)) return { behindPace: null, short: null, lost: null }

  const { avgPace } = ctx
  const cap = SLOT_CAPS[slot]
  const behind = typeof avgPace === 'number' ? avgPace - projection.used : 0
  const short = projection.estimatedRounded === null ? 0 : cap - projection.estimatedRounded
  const lost = projection.maxGamesTotal === null ? 0 : cap - projection.maxGamesTotal

  return {
    // A fractional game (69.3 vs 69) is not a real gap — round before flagging it.
    behindPace: Math.round(behind) > 0 ? behind : null,
    short: short > 0 ? short : null,
    lost: lost > 0 ? lost : null,
  }
}

/**
 * The cap as a denominator. UTIL is written 246+2 rather than 248 so the two spare
 * games stay visible as the ESPN quirk they are, instead of hiding inside a round total.
 */
export function formatCap(slot: SlotName): string {
  const slots = SLOT_MULTIPLICITY[slot]
  if (slots === 1) return String(SLOT_CAPS[slot])
  const base = GAMES_PER_SLOT * slots
  const spare = SLOT_CAPS[slot] - base
  return spare === 0 ? String(base) : `${base}+${spare}`
}

/** Trims a trailing `.0` so whole numbers stay readable in a dense table. */
export function formatSlotNumber(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return '-'
  return Number.isInteger(value) ? String(value) : value.toFixed(digits)
}
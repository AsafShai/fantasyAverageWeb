import { REPORT_MIN_GP } from '../draftReport'

/** Bench player: season rank ≤ this → consider starting. */
export const CONSIDER_START_SEASON_MAX_RANK = 120
/** Bench player: last-15 rank ≤ this → consider starting. */
export const CONSIDER_START_L15_MAX_RANK = 90

/** Starter: season rank > this (outside top N) → consider benching. */
export const CONSIDER_BENCH_SEASON_OUTSIDE_TOP = 180
/** Starter: last-15 rank > this (outside top N) → consider benching. */
export const CONSIDER_BENCH_L15_OUTSIDE_TOP = 210

/** Season value ranks in hints (full-season sample). */
export const HINTS_MIN_GP = REPORT_MIN_GP
/** Last-15 window — light floor so ranks exist without season-length GP. */
export const HINTS_MIN_GP_L15 = 3

export const VISIBLE_HINT_CAP = 6

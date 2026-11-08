/** Bench player: season rank ≤ this → consider starting. */
export const CONSIDER_START_SEASON_MAX_RANK = 120
/** Bench player: last-15 rank ≤ this → consider starting. */
export const CONSIDER_START_L15_MAX_RANK = 90
/** Min games in the last-15 window to use L15 for start/bench hints (rank pool is unfiltered). */
export const CONSIDER_L15_MIN_GP = 2

/** Starter: season rank > this (outside top N) → consider benching. */
export const CONSIDER_BENCH_SEASON_OUTSIDE_TOP = 180
/** Starter: last-15 rank > this (outside top N) → consider benching. */
export const CONSIDER_BENCH_L15_OUTSIDE_TOP = 210

export const VISIBLE_HINT_CAP = 6

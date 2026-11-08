import { REPORT_MIN_GP } from '../draftReport'

/** Bench player inside this rank (L15) triggers a consider-start hint. */
export const BENCH_HOT_MAX_RANK = 80
export const STARTER_COLD_MIN_RANK = 120

export const SEASON_STARTER_POOR_MIN = 150

/** L15 vs season rank delta for heating / cooling copy. */
export const FORM_RANK_DELTA = 45

/** Season value ranks in hints (full-season sample). */
export const HINTS_MIN_GP = REPORT_MIN_GP
/** Last-15 window — light floor so ranks exist without season-length GP. */
export const HINTS_MIN_GP_L15 = 3

export const VISIBLE_HINT_CAP = 6

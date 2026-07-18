export const FF_PLAYER_RANKINGS = import.meta.env.VITE_SHOW_PLAYER_RANKINGS === 'true';
export const FF_MATCHUP_QUALITY = import.meta.env.VITE_FF_MATCHUP_QUALITY === 'true';
export const FF_FEATURE_STORE = import.meta.env.VITE_FF_FEATURE_STORE === 'true';
// Past game days in the Projections/Players slate picker (what-if/debug view).
// Off by default — production users only see the upcoming game days.
export const FF_PAST_SLATES = import.meta.env.VITE_FF_PAST_SLATES === 'true';
export const FF_PROJECTIONS = import.meta.env.VITE_FF_PROJECTIONS === 'true';
export const FF_NAV_REORG = import.meta.env.VITE_FF_NAV_REORG === 'true';
export const FF_CUSTOM_RANGE = import.meta.env.VITE_FF_CUSTOM_RANGE === 'true';
export const FF_DRAFT_REPORT = import.meta.env.VITE_FF_DRAFT_REPORT === 'true';
export const FF_DRAFT_STEALS_BUSTS = import.meta.env.VITE_FF_DRAFT_STEALS_BUSTS === 'true';

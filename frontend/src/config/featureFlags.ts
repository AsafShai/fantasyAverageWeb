export const FF_FEATURE_STORE = import.meta.env.VITE_FF_FEATURE_STORE === 'true';
// Past game days in the Projections/Players slate picker (what-if/debug view).
// Off by default — production users only see the upcoming game days.
export const FF_PAST_SLATES = import.meta.env.VITE_FF_PAST_SLATES === 'true';
export const FF_PROJECTIONS = import.meta.env.VITE_FF_PROJECTIONS === 'true';
export const FF_DRAFT_REPORT = import.meta.env.VITE_FF_DRAFT_REPORT === 'true';
export const FF_DRAFT_PAGES = import.meta.env.VITE_FF_DRAFT_PAGES === 'true';
export const FF_DRAFT_STEALS_BUSTS = import.meta.env.VITE_FF_DRAFT_STEALS_BUSTS === 'true';

export const FF_FEATURE_STORE = import.meta.env.VITE_FF_FEATURE_STORE === 'true';
// Past game days in the Projections/Players slate picker (what-if/debug view).
// Off by default — production users only see the upcoming game days.
export const FF_PAST_SLATES = import.meta.env.VITE_FF_PAST_SLATES === 'true';
// Boom or Bust page: surprises and disappointments of the last NBA night.
export const FF_BOOM_OR_BUST = import.meta.env.VITE_FF_BOOM_OR_BUST === 'true';
export const FF_DRAFT_REPORT = import.meta.env.VITE_FF_DRAFT_REPORT === 'true';
export const FF_DRAFT_PAGES = import.meta.env.VITE_FF_DRAFT_PAGES === 'true';
export const FF_DRAFT_STEALS_BUSTS = import.meta.env.VITE_FF_DRAFT_STEALS_BUSTS === 'true';
// Share-as-image cards on Rankings, Team Detail and the Trade Analyzer.
export const FF_SHARE_CARDS = import.meta.env.VITE_FF_SHARE_CARDS === 'true';
// League Activity page (adds/drops/trades, trade history + tree) and the Today "Latest moves" card.
export const FF_LEAGUE_ACTIVITY = import.meta.env.VITE_FF_LEAGUE_ACTIVITY === 'true';
// Mobile redesign (phones, below the md breakpoint). Build-time default; the
// owner can also switch it on for one browser with ?ff=mobile (and back off
// with ?ff=off). See src/mobile/flag.ts for the runtime override.
export const FF_MOBILE_REDESIGN = import.meta.env.VITE_FF_MOBILE_REDESIGN === 'true';
// Personalized lineup / roster coaching hints on your Team page (my team only).
export const FF_MANAGER_HINTS =
  import.meta.env.VITE_FF_MANAGER_HINTS === 'false' ? false : true;

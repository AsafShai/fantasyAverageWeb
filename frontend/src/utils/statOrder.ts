// The one stat-column order every table in the app follows, matching the
// Players page (and ESPN's own category order): shooting percentages first,
// then counting stats, PTS last. Categories a league scores beyond these keep
// their relative order after the known ones.
export const CATEGORY_DISPLAY_ORDER = ['FG%', 'FT%', '3P%', '3PM', 'REB', 'AST', 'STL', 'BLK', 'TO', 'PTS']

const categoryRank = (c: string) => {
  const i = CATEGORY_DISPLAY_ORDER.indexOf(c)
  return i === -1 ? CATEGORY_DISPLAY_ORDER.length : i
}

/** League categories in the order the rest of the app shows them. */
export function orderCategories<T extends string>(categories: readonly T[]): T[] {
  return [...categories].sort((a, b) => categoryRank(a) - categoryRank(b))
}

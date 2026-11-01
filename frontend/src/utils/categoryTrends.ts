import type { CategoryStatItem, CountingCategory, GameLogEntry } from '../types/api'
import { orderCategories } from './statOrder'
import { DEFAULT_CATEGORIES } from './playerRankings'

/** Every counting category the trends backend measures, in the app's column order. */
export const COUNTING_CATEGORIES: CountingCategory[] = orderCategories(['PTS', 'REB', 'AST', '3PM', 'STL', 'BLK', 'TO'])

/** Game-log field behind each counting category. */
export const CATEGORY_FIELD: Record<CountingCategory, keyof GameLogEntry> = {
  PTS: 'pts',
  REB: 'reb',
  AST: 'ast',
  '3PM': 'fg3m',
  STL: 'stl',
  BLK: 'blk',
  TO: 'tov',
}

export function isCountingCategory(c: string): c is CountingCategory {
  return c in CATEGORY_FIELD
}

/** League categories the trends backend can measure, in display order. Only
 * what the league scores is shown (no TO unless the league counts it); while
 * the league list is unknown, the app-wide default categories stand in. */
export function countingCategoriesOf(categories: readonly string[] | undefined): CountingCategory[] {
  const source = categories?.length ? categories : DEFAULT_CATEGORIES
  return orderCategories(source.filter(isCountingCategory))
}

/** Whether a change helps a fantasy line: up is good, except for
 * reverse-scored categories (TO), where down is good. */
export function isGoodChange(delta: number, cat: CountingCategory, reverse: ReadonlySet<string>): boolean {
  return reverse.has(cat) ? delta < 0 : delta >= 0
}

/** z with the sign flipped for reverse-scored categories, so positive always
 * means "helping". null when the backend could not measure a spread. */
export function helpfulZ(stat: CategoryStatItem, reverse: ReadonlySet<string>): number | null {
  if (stat.z === null) return null
  return reverse.has(stat.cat) ? -stat.z : stat.z
}

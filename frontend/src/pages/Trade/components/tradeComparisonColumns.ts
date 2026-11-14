import {
  COMPOSITE_FG,
  COMPOSITE_FT,
  COLUMN_TO_CATEGORY,
  categoryOnlyColumnKeys,
} from '../utils/tradeCategoryZ';
import { STAT_KEYS } from '../constants';

export interface DisplayColumn {
  key: string;
  label: string;
  icon: string;
  extraCategory?: string;
  composite?: 'fg' | 'ft';
}

const STAT_HEADERS = [
  { label: 'MIN', icon: '⏰' },
  { label: 'FGM', icon: '🎯' },
  { label: 'FGA', icon: '🏹' },
  { label: 'FG%', icon: '📈' },
  { label: 'FTM', icon: '🆓' },
  { label: 'FTA', icon: '🎯' },
  { label: 'FT%', icon: '📊' },
  { label: '3PM', icon: '🎯' },
  { label: 'REB', icon: '🏀' },
  { label: 'AST', icon: '🤝' },
  { label: 'STL', icon: '🥷' },
  { label: 'BLK', icon: '🛡️' },
  { label: 'PTS', icon: '🏀' },
  { label: 'GP', icon: '📅' },
] as const;

const NEUTRAL_COLUMN_KEYS = new Set(['minutes', 'fgm', 'fga', 'ftm', 'fta', 'gp']);

export function isNeutralColumn(key: string): boolean {
  return NEUTRAL_COLUMN_KEYS.has(key);
}

export function scoringCategoryForColumn(column: DisplayColumn): string | undefined {
  if (column.composite === 'fg') return 'FG%';
  if (column.composite === 'ft') return 'FT%';
  if (column.extraCategory) return column.extraCategory;
  return COLUMN_TO_CATEGORY[column.key];
}

export function columnFromKey(key: string): DisplayColumn | null {
  if (key === COMPOSITE_FG) return { key, label: 'FG%', icon: '🎯', composite: 'fg' };
  if (key === COMPOSITE_FT) return { key, label: 'FT%', icon: '🆓', composite: 'ft' };
  if (key.startsWith('extra:')) {
    const category = key.slice('extra:'.length);
    return { key, label: category, icon: '➕', extraCategory: category };
  }
  const idx = STAT_KEYS.indexOf(key as typeof STAT_KEYS[number]);
  if (idx === -1) return null;
  return { key, label: STAT_HEADERS[idx].label, icon: STAT_HEADERS[idx].icon };
}

export function categoryOnlyColumns(extraCategories: string[]): DisplayColumn[] {
  return categoryOnlyColumnKeys(extraCategories)
    .map(columnFromKey)
    .filter((c): c is DisplayColumn => c != null);
}

export function categoryShortcutKeys(extraCategories: string[]): Set<string> {
  return new Set(categoryOnlyColumnKeys(extraCategories));
}

export function isCategoriesOnlyView(
  shown: (key: string) => boolean,
  extraCategories: string[],
): boolean {
  const keys = categoryOnlyColumnKeys(extraCategories);
  if (!keys.every(shown)) return false;
  return ['minutes', 'fgm', 'fga', 'fg_percentage', 'ftm', 'fta', 'ft_percentage', 'gp']
    .every(k => !shown(k));
}